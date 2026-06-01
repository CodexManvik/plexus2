"""
Ingestion service for file uploads.
Phase 2 implementation (without OCI Object Storage for now).
"""

import os
import hashlib
import uuid
from typing import Optional
from fastapi import UploadFile
from ..database import db_pool
from ..services.workflow_service import WorkflowService
from ..services.audit_service import AuditService
import logging

logger = logging.getLogger(__name__)


class IngestionService:
    """Handles file upload and contract creation."""
    
    # Local storage path (replace with OCI in production)
    UPLOAD_DIR = "uploads"
    
    @staticmethod
    def _ensure_upload_dir():
        """Ensure upload directory exists."""
        os.makedirs(IngestionService.UPLOAD_DIR, exist_ok=True)
    
    @staticmethod
    def _calculate_checksum(file_path: str) -> str:
        """Calculate SHA-256 checksum of file."""
        sha256 = hashlib.sha256()
        with open(file_path, 'rb') as f:
            for chunk in iter(lambda: f.read(4096), b''):
                sha256.update(chunk)
        return sha256.hexdigest()
    
    @staticmethod
    async def ingest_file(
        file: UploadFile,
        user_id: str,
        organization: Optional[str] = None,
        business_unit: Optional[str] = None,
        location: Optional[str] = None,
        department: Optional[str] = None,
        customer_name: Optional[str] = None,
        financial_year: Optional[str] = None,
        contract_type: Optional[str] = None,
        agreement_type: Optional[str] = None,
        additional_info: Optional[str] = None
    ) -> str:
        """
        Ingest uploaded file and create contract record.
        
        Args:
            file: Uploaded file
            user_id: User uploading the file
            ... metadata fields
        
        Returns:
            contract_id (UUID)
        """
        IngestionService._ensure_upload_dir()
        
        # Generate contract ID
        contract_id = uuid.uuid4().hex.upper()
        
        # Save file locally
        file_extension = os.path.splitext(file.filename)[1]
        local_filename = f"{contract_id}{file_extension}"
        local_path = os.path.join(IngestionService.UPLOAD_DIR, local_filename)
        
        # Write file
        with open(local_path, 'wb') as f:
            content = await file.read()
            f.write(content)
        
        file_size = len(content)
        checksum = IngestionService._calculate_checksum(local_path)
        
        # Create contract record
        query = """
            INSERT INTO contracts (
                contract_id, organization, business_unit, location, department,
                customer_name, financial_year, contract_type, agreement_type,
                additional_info, original_filename, file_size_bytes, file_checksum,
                oci_object_key, mime_type, workflow_state, uploaded_by
            ) VALUES (
                :contract_id, :organization, :business_unit, :location, :department,
                :customer_name, :financial_year, :contract_type, :agreement_type,
                :additional_info, :original_filename, :file_size_bytes, :file_checksum,
                :oci_object_key, :mime_type, 'UPLOADED', :uploaded_by
            )
        """
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {
                    'contract_id': contract_id,
                    'organization': organization,
                    'business_unit': business_unit,
                    'location': location,
                    'department': department,
                    'customer_name': customer_name,
                    'financial_year': financial_year,
                    'contract_type': contract_type,
                    'agreement_type': agreement_type,
                    'additional_info': additional_info,
                    'original_filename': file.filename,
                    'file_size_bytes': file_size,
                    'file_checksum': checksum,
                    'oci_object_key': local_path,  # Store local path for now
                    'mime_type': file.content_type,
                    'uploaded_by': user_id
                })
                await conn.commit()
        
        # Audit log
        await AuditService.log(
            contract_id=contract_id,
            user_id=user_id,
            action='CONTRACT_UPLOADED',
            entity_type='contract',
            entity_id=contract_id,
            new_value=file.filename,
            metadata={
                'file_size': file_size,
                'mime_type': file.content_type,
                'contract_type': contract_type
            }
        )
        
        logger.info(f"File ingested: {file.filename} -> {contract_id}")
        
        return contract_id
    
    @staticmethod
    async def get_file_path(contract_id: str) -> Optional[str]:
        """Get local file path for a contract."""
        query = "SELECT oci_object_key FROM contracts WHERE contract_id = HEXTORAW(:contract_id)"

        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {'contract_id': contract_id})
                row = await cursor.fetchone()
                return row[0] if row else None
    
    @staticmethod
    async def get_contract(contract_id: str) -> Optional[dict]:
        """Get contract metadata."""
        query = """
            SELECT contract_id, organization, business_unit, location, department,
                   customer_name, financial_year, contract_type, agreement_type,
                   additional_info, original_filename, file_size_bytes, mime_type,
                   page_count, workflow_state, uploaded_by, uploaded_at
            FROM contracts
            WHERE contract_id = :contract_id
        """
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {'contract_id': contract_id})
                row = await cursor.fetchone()
                
                if not row:
                    return None
                
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
                    'additional_info': row[9],
                    'original_filename': row[10],
                    'file_size_bytes': row[11],
                    'mime_type': row[12],
                    'page_count': row[13],
                    'workflow_state': row[14],
                    'uploaded_by': row[15],
                    'uploaded_at': row[16]
                }
