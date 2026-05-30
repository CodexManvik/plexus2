"""
AI Assistant routes.
Phase 5: Full implementation.
PUBLISHED DATA ONLY — never query draft tables here.
"""

from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel
from typing import Optional, List
from ..auth.dependencies import get_current_user
from ..services.assistant_service import AssistantService
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/assistant", tags=["Assistant"])


class QueryRequest(BaseModel):
    """Model for assistant query request."""
    question: str
    contract_ids: Optional[List[str]] = None
    limit: int = 20


@router.post("/query")
async def query_assistant(
    request: QueryRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Query AI assistant with contract scope.
    PUBLISHED DATA ONLY — never query draft tables here.
    """
    try:
        result = await AssistantService.query(
            question=request.question,
            contract_ids=request.contract_ids,
            limit=request.limit
        )
        
        return result
    
    except Exception as e:
        logger.error(f"Assistant query failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Assistant query failed: {str(e)}"
        )


@router.get("/contracts")
async def get_published_contracts(
    current_user: dict = Depends(get_current_user)
):
    """Get list of published contracts for scope selection."""
    try:
        contracts = await AssistantService.get_published_contracts()
        
        return {
            'contracts': contracts,
            'count': len(contracts)
        }
    
    except Exception as e:
        logger.error(f"Failed to get contracts: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get contracts: {str(e)}"
        )
