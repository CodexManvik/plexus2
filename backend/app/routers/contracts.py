"""
Contract management routes.
Full implementation.
"""

from fastapi import APIRouter, HTTPException, status, Depends, Query
from fastapi.responses import FileResponse
from typing import Optional
from ..auth.dependencies import get_current_user, require_role
from ..auth.models import UserRole
from ..database import db_pool
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/contracts", tags=["Contracts"])


@router.get("/")
async def list_contracts(
    workflow_state: Optional[str] = Query(None),
    contract_type: Optional[str] = Query(None),
    department: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(get_current_user)
):
    """List all contracts accessible to current user."""
    try:
        where_clauses = []
        params = {'limit': limit, 'offset': offset}
        
        if workflow_state:
            where_clauses.append("workflow_state = :workflow_state")
            params['workflow_state'] = workflow_state
        
        if contract_type:
            where_clauses.append("contract_type = :contract_type")
            params['contract_type'] = contract_type
        
        if department:
            where_clauses.append("department = :department")
            params['department'] = department
        
        where_clause = " AND ".join(where_clauses) if where_clauses else "1=1"
        
        query = f"""
            SELECT contract_id, original_filename, customer_name, contract_type,
                   department, workflow_state, uploaded_at, approved_at, published_at
            FROM contracts
            WHERE {where_clause}
            ORDER BY uploaded_at DESC
            OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
        """
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, params)
                rows = await cursor.fetchall()
                
                contracts = [
                    {
                        'contract_id': row[0],
                        'filename': row[1],
                        'customer_name': row[2],
                        'contract_type': row[3],
                        'department': row[4],
                        'workflow_state': row[5],
                        'uploaded_at': row[6],
                        'approved_at': row[7],
                        'published_at': row[8]
                    }
                    for row in rows
                ]
                
                return {
                    'contracts': contracts,
                    'count': len(contracts),
                    'limit': limit,
                    'offset': offset
                }
    
    except Exception as e:
        logger.error(f"Failed to list contracts: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list contracts: {str(e)}"
        )


@router.get("/{contract_id}")
async def get_contract(
    contract_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get contract details by ID."""
    try:
        query = """
            SELECT contract_id, organization, business_unit, location, department,
                   customer_name, financial_year, contract_type, agreement_type,
                   original_filename, file_size_bytes, mime_type, page_count,
                   workflow_state, uploaded_by, reviewed_by, approved_by,
                   uploaded_at, approved_at, published_at
            FROM contracts
            WHERE contract_id = HEXTORAW(:contract_id)
        """
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {'contract_id': contract_id})
                row = await cursor.fetchone()
                
                if not row:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="Contract not found"
                    )
                
                return {
                    'contract_id': row[0],
                    'organization': row[1],
                    'business_unit': row[2],
                    'location': row[3],
                    'department': row[4],
                    'customer_name': row[5],
                    'financial_year': row[6],
                    'contract_type': row[7],
                    'agreement_type': row[8],
                    'filename': row[9],
                    'file_size_bytes': row[10],
                    'mime_type': row[11],
                    'page_count': row[12],
                    'workflow_state': row[13],
                    'uploaded_by': row[14],
                    'reviewed_by': row[15],
                    'approved_by': row[16],
                    'uploaded_at': row[17],
                    'approved_at': row[18],
                    'published_at': row[19]
                }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get contract: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get contract: {str(e)}"
        )


@router.delete("/{contract_id}")
async def delete_contract(
    contract_id: str,
    current_user: dict = Depends(require_role(UserRole.ADMIN))
):
    """Delete contract (admin only)."""
    try:
        # Delete in reverse dependency order
        queries = [
            "DELETE FROM draft_grounding_records WHERE param_id IN (SELECT param_id FROM draft_parameters WHERE contract_id = HEXTORAW(:contract_id))",
            "DELETE FROM draft_parameters WHERE contract_id = HEXTORAW(:contract_id)",
            "DELETE FROM draft_tag_suggestions WHERE contract_id = HEXTORAW(:contract_id)",
            "DELETE FROM published_parameters WHERE contract_id = HEXTORAW(:contract_id)",
            "DELETE FROM document_blocks WHERE contract_id = HEXTORAW(:contract_id)",
            "DELETE FROM workflow_transitions WHERE contract_id = HEXTORAW(:contract_id)",
            "DELETE FROM contracts WHERE contract_id = HEXTORAW(:contract_id)"
        ]
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                for query in queries:
                    await cursor.execute(query, {'contract_id': contract_id})
                await conn.commit()
        
        return {'contract_id': contract_id, 'status': 'deleted'}
    
    except Exception as e:
        logger.error(f"Failed to delete contract: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete contract: {str(e)}"
        )


@router.get("/{contract_id}/pdf-url")
async def get_contract_pdf_url(
    contract_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Get a short-lived presigned URL to the OCI object for the contract file,
    or a backend local file-serving URL if OCI is not configured or in dev mode.
    Returns url and file_type so the viewer can branch (pdf/docx/xlsx).
    """
    try:
        # 1. Fetch contract record
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(
                    "SELECT oci_object_key, mime_type FROM contracts WHERE contract_id = HEXTORAW(:contract_id)",
                    {'contract_id': contract_id}
                )
                row = await cursor.fetchone()
                if not row:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="Contract not found"
                    )
                oci_object_key, mime_type = row[0], row[1]

        # Determine file_type string for the frontend viewer to branch on
        _mime_to_type = {
            'application/pdf': 'pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
            'application/vnd.ms-excel': 'xlsx',
        }
        file_type = _mime_to_type.get(mime_type or '', 'pdf')

        # 2. Check if we should generate OCI PAR (Pre-Authenticated Request)
        from ..config import settings
        import oci
        from datetime import datetime, timedelta
        import uuid

        # If the key is local or OCI namespace/bucket is missing, use local endpoint
        if (not oci_object_key or
                oci_object_key.startswith("uploads") or
                not settings.oci_namespace or
                not settings.oci_bucket_name):
            local_url = f"{settings.backend_url}/contracts/{contract_id}/file"
            return {"url": local_url, "file_type": file_type, "requires_auth_header": True}

        try:
            # Setup OCI client
            config = oci.config.from_file(
                file_location=settings.oci_config_file,
                profile_name=settings.oci_profile
            )
            object_storage_client = oci.object_storage.ObjectStorageClient(config)

            # Create a PAR valid for 15 minutes
            time_expires = datetime.utcnow() + timedelta(minutes=15)
            par_details = oci.object_storage.models.CreatePreauthenticatedRequestDetails(
                name=f"par-review-{contract_id[:8]}-{uuid.uuid4().hex[:8]}",
                access_type="ObjectRead",
                object_name=oci_object_key,
                time_expires=time_expires
            )

            par = object_storage_client.create_preauthenticated_request(
                namespace_name=settings.oci_namespace,
                bucket_name=settings.oci_bucket_name,
                create_preauthenticated_request_details=par_details
            )

            region = settings.oci_region or config.get("region", "us-ashburn-1")
            par_url = f"https://objectstorage.{region}.oraclecloud.com{par.data.access_uri}"

            return {"url": par_url, "file_type": file_type, "requires_auth_header": False}

        except Exception as oci_err:
            logger.warning(f"OCI PAR generation failed, falling back to local file serving: {oci_err}")
            local_url = f"{settings.backend_url}/contracts/{contract_id}/file"
            return {"url": local_url, "file_type": file_type, "requires_auth_header": True}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate file URL: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate file URL: {str(e)}"
        )


@router.get("/{contract_id}/file")
async def get_contract_file(
    contract_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Serves the original contract file (PDF, DOCX, or XLSX) from local disk.
    Requires Bearer auth header. Used by the frontend DocumentViewer component.
    """
    import os

    try:
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(
                    "SELECT oci_object_key, original_filename, mime_type FROM contracts WHERE contract_id = HEXTORAW(:contract_id)",
                    {'contract_id': contract_id}
                )
                row = await cursor.fetchone()
                if not row:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="Contract not found"
                    )
                file_path, filename, mime_type = row[0], row[1], row[2]

        if not file_path or not os.path.exists(file_path):
            # Fallback: try uploads/<contract_id>.<ext>
            _mime_ext = {
                'application/pdf': 'pdf',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
            }
            ext = _mime_ext.get(mime_type or '', 'pdf')
            for try_ext in [ext, 'pdf', 'docx']:
                candidate = os.path.join("uploads", f"{contract_id}.{try_ext}")
                if os.path.exists(candidate):
                    file_path = candidate
                    break
            else:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Contract file not found on disk"
                )

        return FileResponse(
            path=file_path,
            media_type=mime_type or "application/octet-stream",
            filename=filename or f"{contract_id}",
            headers={"Cache-Control": "no-store"}
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to serve contract file: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to serve contract file: {str(e)}"
        )


@router.get("/{contract_id}/pdf")
async def get_contract_pdf(
    contract_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Backward-compatible alias that forwards to /file."""
    return await get_contract_file(contract_id, current_user)
