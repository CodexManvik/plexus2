"""
Upload and tagging routes.
Phase 2: Full implementation.
"""

from fastapi import APIRouter, HTTPException, status, Depends, UploadFile, File, Form
from typing import Optional
from ..auth.dependencies import get_current_user, require_role
from ..auth.models import UserRole
from ..services.ingestion_service import IngestionService
from ..services.parsing_service import ParsingService
from ..services.tag_suggestion_service import TagSuggestionService
from ..services.workflow_service import WorkflowService
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/upload", tags=["Upload"])


@router.post("/")
async def upload_contract(
    file: UploadFile = File(...),
    organization: Optional[str] = Form(None),
    business_unit: Optional[str] = Form(None),
    location: Optional[str] = Form(None),
    department: Optional[str] = Form(None),
    customer_name: Optional[str] = Form(None),
    financial_year: Optional[str] = Form(None),
    contract_type: Optional[str] = Form(None),
    agreement_type: Optional[str] = Form(None),
    additional_info: Optional[str] = Form(None),
    current_user: dict = Depends(require_role(UserRole.OPERATION_USER, UserRole.OPERATION_HEAD))
):
    """
    Upload contract file and initiate processing.
    
    Workflow: UPLOADED → PARSING → TAG_SUGGESTION_READY
    """
    try:
        # Validate file type
        allowed_types = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
        if file.content_type not in allowed_types:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported file type: {file.content_type}. Only PDF and DOCX allowed."
            )
        
        # Ingest file
        contract_id = await IngestionService.ingest_file(
            file=file,
            user_id=current_user['user_id'],
            organization=organization,
            business_unit=business_unit,
            location=location,
            department=department,
            customer_name=customer_name,
            financial_year=financial_year,
            contract_type=contract_type,
            agreement_type=agreement_type,
            additional_info=additional_info
        )
        
        # Transition to PARSING
        await WorkflowService.transition(
            contract_id=contract_id,
            to_state='PARSING',
            user_id=current_user['user_id'],
            reason='File uploaded successfully'
        )
        
        # Parse document
        file_path = await IngestionService.get_file_path(contract_id)
        
        if file.content_type == 'application/pdf':
            blocks_created = await ParsingService.parse_pdf(file_path, contract_id)
        else:
            blocks_created = await ParsingService.parse_docx(file_path, contract_id)
        
        logger.info(f"Parsed {blocks_created} blocks for contract {contract_id}")
        
        # Transition to TAG_SUGGESTION_READY
        await WorkflowService.transition(
            contract_id=contract_id,
            to_state='TAG_SUGGESTION_READY',
            user_id=current_user['user_id'],
            reason=f'Parsing complete: {blocks_created} blocks'
        )
        
        # Generate tag suggestions
        suggestions = await TagSuggestionService.generate_suggestions(contract_id)
        
        return {
            'contract_id': contract_id,
            'filename': file.filename,
            'blocks_created': blocks_created,
            'suggestions_count': len(suggestions),
            'workflow_state': 'TAG_SUGGESTION_READY'
        }
    
    except Exception as e:
        logger.error(f"Upload failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Upload failed: {str(e)}"
        )


@router.get("/{contract_id}/tags/suggest")
async def get_tag_suggestions(
    contract_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get AI-suggested tags for uploaded contract."""
    try:
        suggestions = await TagSuggestionService.get_suggestions(contract_id)
        
        return {
            'contract_id': contract_id,
            'suggestions': suggestions,
            'count': len(suggestions)
        }
    
    except Exception as e:
        logger.error(f"Failed to get suggestions: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get suggestions: {str(e)}"
        )


@router.post("/{contract_id}/tags/{suggestion_id}/accept")
async def accept_tag_suggestion(
    contract_id: str,
    suggestion_id: str,
    current_user: dict = Depends(require_role(UserRole.OPERATION_USER, UserRole.OPERATION_HEAD))
):
    """Accept a tag suggestion and apply it to the contract."""
    try:
        await TagSuggestionService.accept_suggestion(suggestion_id, contract_id)
        
        return {
            'contract_id': contract_id,
            'suggestion_id': suggestion_id,
            'status': 'accepted'
        }
    
    except Exception as e:
        logger.error(f"Failed to accept suggestion: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to accept suggestion: {str(e)}"
        )
