"""
Document parsing service.
Converts PDF/DOCX to canonical positioned blocks.
Phase 2 implementation.
"""

import fitz  # PyMuPDF
import pdfplumber
from docx import Document
from typing import List, Dict, Optional
import uuid
from ..database import db_pool
from ..utils.bbox import normalize_bbox
import logging

logger = logging.getLogger(__name__)


class ParsingService:
    """Parses documents into canonical positioned blocks."""
    
    @staticmethod
    async def parse_pdf(file_path: str, contract_id: str) -> int:
        """
        Parse PDF into canonical blocks using PyMuPDF.
        
        Args:
            file_path: Path to PDF file
            contract_id: Contract UUID
        
        Returns:
            Number of blocks created
        """
        blocks_created = 0
        
        try:
            doc = fitz.open(file_path)
            
            for page_num in range(len(doc)):
                page = doc[page_num]
                page_width = page.rect.width
                page_height = page.rect.height
                
                # Extract text blocks with positions
                blocks = page.get_text("dict")["blocks"]
                
                block_order = 0
                for block in blocks:
                    if block.get("type") == 0:  # Text block
                        # Extract text
                        lines = block.get("lines", [])
                        text_parts = []
                        
                        for line in lines:
                            for span in line.get("spans", []):
                                text_parts.append(span.get("text", ""))
                        
                        raw_text = " ".join(text_parts).strip()
                        
                        if not raw_text:
                            continue
                        
                        # Get bounding box
                        bbox = block.get("bbox", [0, 0, 0, 0])
                        x1, y1, x2, y2 = bbox
                        
                        # Normalize coordinates
                        norm_x1, norm_y1, norm_x2, norm_y2 = normalize_bbox(
                            x1, y1, x2, y2, page_width, page_height
                        )
                        
                        # Determine block type (simple heuristic)
                        block_type = "paragraph"
                        if len(raw_text) < 100 and raw_text.isupper():
                            block_type = "heading"
                        
                        # Insert block
                        await ParsingService._insert_block(
                            contract_id=contract_id,
                            page_number=page_num + 1,
                            block_type=block_type,
                            raw_text=raw_text,
                            normalized_text=raw_text.lower().strip(),
                            bbox_x1=norm_x1,
                            bbox_y1=norm_y1,
                            bbox_x2=norm_x2,
                            bbox_y2=norm_y2,
                            block_order=block_order
                        )
                        
                        blocks_created += 1
                        block_order += 1
            
            doc.close()
            logger.info(f"Parsed PDF: {blocks_created} blocks from {len(doc)} pages")
            
            # Update contract page count
            await ParsingService._update_page_count(contract_id, len(doc))
            
            return blocks_created
        
        except Exception as e:
            logger.error(f"PDF parsing failed: {e}")
            raise
    
    @staticmethod
    async def parse_docx(file_path: str, contract_id: str) -> int:
        """
        Parse DOCX into canonical blocks.
        
        Args:
            file_path: Path to DOCX file
            contract_id: Contract UUID
        
        Returns:
            Number of blocks created
        """
        blocks_created = 0
        
        try:
            doc = Document(file_path)
            page_num = 1  # DOCX doesn't have explicit pages
            block_order = 0
            
            for para in doc.paragraphs:
                raw_text = para.text.strip()
                
                if not raw_text:
                    continue
                
                # Determine block type
                block_type = "paragraph"
                if para.style.name.startswith('Heading'):
                    block_type = "heading"
                
                # DOCX doesn't have bounding boxes, use placeholder
                await ParsingService._insert_block(
                    contract_id=contract_id,
                    page_number=page_num,
                    block_type=block_type,
                    raw_text=raw_text,
                    normalized_text=raw_text.lower().strip(),
                    bbox_x1=0.0,
                    bbox_y1=0.0,
                    bbox_x2=1.0,
                    bbox_y2=0.0,
                    block_order=block_order
                )
                
                blocks_created += 1
                block_order += 1
            
            logger.info(f"Parsed DOCX: {blocks_created} blocks")
            
            # Estimate page count (rough: 500 words per page)
            word_count = sum(len(p.text.split()) for p in doc.paragraphs)
            estimated_pages = max(1, word_count // 500)
            await ParsingService._update_page_count(contract_id, estimated_pages)
            
            return blocks_created
        
        except Exception as e:
            logger.error(f"DOCX parsing failed: {e}")
            raise
    
    @staticmethod
    async def _insert_block(
        contract_id: str,
        page_number: int,
        block_type: str,
        raw_text: str,
        normalized_text: str,
        bbox_x1: float,
        bbox_y1: float,
        bbox_x2: float,
        bbox_y2: float,
        block_order: int,
        section_heading: Optional[str] = None,
        table_context: Optional[str] = None
    ):
        """Insert a canonical block into the database."""
        query = """
            INSERT INTO document_blocks (
                contract_id, page_number, block_type, raw_text, normalized_text,
                bbox_x1, bbox_y1, bbox_x2, bbox_y2, block_order,
                section_heading, table_context
            ) VALUES (
                :contract_id, :page_number, :block_type, :raw_text, :normalized_text,
                :bbox_x1, :bbox_y1, :bbox_x2, :bbox_y2, :block_order,
                :section_heading, :table_context
            )
        """
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {
                    'contract_id': contract_id,
                    'page_number': page_number,
                    'block_type': block_type,
                    'raw_text': raw_text,
                    'normalized_text': normalized_text,
                    'bbox_x1': bbox_x1,
                    'bbox_y1': bbox_y1,
                    'bbox_x2': bbox_x2,
                    'bbox_y2': bbox_y2,
                    'block_order': block_order,
                    'section_heading': section_heading,
                    'table_context': table_context
                })
                await conn.commit()
    
    @staticmethod
    async def _update_page_count(contract_id: str, page_count: int):
        """Update contract page count."""
        query = """
            UPDATE contracts
            SET page_count = :page_count
            WHERE contract_id = :contract_id
        """
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {
                    'contract_id': contract_id,
                    'page_count': page_count
                })
                await conn.commit()
    
    @staticmethod
    async def get_blocks_for_contract(contract_id: str) -> List[Dict]:
        """Retrieve all blocks for a contract."""
        query = """
            SELECT block_id, page_number, block_type, raw_text, normalized_text,
                   bbox_x1, bbox_y1, bbox_x2, bbox_y2, block_order,
                   section_heading, table_context
            FROM document_blocks
            WHERE contract_id = :contract_id
            ORDER BY page_number, block_order
        """
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {'contract_id': contract_id})
                rows = await cursor.fetchall()
                
                blocks = []
                for row in rows:
                    # Read CLOB fields if they are AsyncLOB objects
                    raw_text = row[3]
                    if hasattr(raw_text, 'read'):
                        raw_text = await raw_text.read()
                    
                    normalized_text = row[4]
                    if hasattr(normalized_text, 'read'):
                        normalized_text = await normalized_text.read()
                    
                    blocks.append({
                        'block_id': row[0],
                        'page_number': row[1],
                        'block_type': row[2],
                        'raw_text': raw_text,
                        'normalized_text': normalized_text,
                        'bbox_x1': row[5],
                        'bbox_y1': row[6],
                        'bbox_x2': row[7],
                        'bbox_y2': row[8],
                        'block_order': row[9],
                        'section_heading': row[10],
                        'table_context': row[11]
                    })
                
                return blocks
