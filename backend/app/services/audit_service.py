"""
Audit logging service.
Records all significant actions for compliance and debugging.
Rule 5: Every audit event is written.
"""

from typing import Optional, Any
import json
from datetime import datetime
from ..database import execute_query
import logging

logger = logging.getLogger(__name__)


class AuditService:
    """Centralized audit logging for all system actions."""
    
    @staticmethod
    async def log(
        action: str,
        user_id: Optional[str] = None,
        contract_id: Optional[str] = None,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
        old_value: Optional[Any] = None,
        new_value: Optional[Any] = None,
        metadata: Optional[dict] = None
    ):
        """
        Write audit log entry.
        
        Args:
            action: Action type (e.g., 'PARAMETER_EDITED', 'LOGIN_SUCCESS', 'WORKFLOW_TRANSITION')
            user_id: User performing the action (None for system actions)
            contract_id: Related contract ID (if applicable)
            entity_type: Type of entity affected (e.g., 'parameter', 'user', 'contract')
            entity_id: ID of affected entity
            old_value: Previous value (for updates)
            new_value: New value (for updates/creates)
            metadata: Additional context as dict (will be JSON serialized)
        """
        query = """
            INSERT INTO audit_log (
                contract_id, user_id, action, entity_type, entity_id,
                old_value, new_value, metadata
            )
            VALUES (
                :contract_id, :user_id, :action, :entity_type, :entity_id,
                :old_value, :new_value, :metadata
            )
        """
        
        # Serialize complex values to JSON strings
        old_value_str = json.dumps(old_value) if old_value is not None and not isinstance(old_value, str) else old_value
        new_value_str = json.dumps(new_value) if new_value is not None and not isinstance(new_value, str) else new_value
        metadata_str = json.dumps(metadata) if metadata else None
        
        try:
            await execute_query(query, {
                'contract_id': contract_id,
                'user_id': user_id,
                'action': action,
                'entity_type': entity_type,
                'entity_id': entity_id,
                'old_value': old_value_str,
                'new_value': new_value_str,
                'metadata': metadata_str
            })
        except Exception as e:
            # Audit logging should never break the main flow
            logger.error(f"Failed to write audit log: {e}")
    
    @staticmethod
    async def query_logs(
        contract_id: Optional[str] = None,
        user_id: Optional[str] = None,
        action: Optional[str] = None,
        entity_type: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        limit: int = 100,
        offset: int = 0
    ) -> list:
        """
        Query audit logs with filters.
        
        Returns list of audit log entries matching criteria.
        """
        conditions = []
        params = {}
        
        if contract_id:
            conditions.append("contract_id = :contract_id")
            params['contract_id'] = contract_id
        
        if user_id:
            conditions.append("user_id = :user_id")
            params['user_id'] = user_id
        
        if action:
            conditions.append("action = :action")
            params['action'] = action
        
        if entity_type:
            conditions.append("entity_type = :entity_type")
            params['entity_type'] = entity_type
        
        if start_date:
            conditions.append("created_at >= :start_date")
            params['start_date'] = start_date
        
        if end_date:
            conditions.append("created_at <= :end_date")
            params['end_date'] = end_date
        
        where_clause = " AND ".join(conditions) if conditions else "1=1"
        
        query = f"""
            SELECT log_id, contract_id, user_id, action, entity_type, entity_id,
                   old_value, new_value, metadata, created_at
            FROM audit_log
            WHERE {where_clause}
            ORDER BY created_at DESC
            OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
        """
        
        params['offset'] = offset
        params['limit'] = limit
        
        from ..database import db_pool
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, params)
                rows = await cursor.fetchall()
                
                return [
                    {
                        'log_id': row[0],
                        'contract_id': row[1],
                        'user_id': row[2],
                        'action': row[3],
                        'entity_type': row[4],
                        'entity_id': row[5],
                        'old_value': row[6],
                        'new_value': row[7],
                        'metadata': json.loads(row[8]) if row[8] else None,
                        'created_at': row[9]
                    }
                    for row in rows
                ]
    
    @staticmethod
    async def get_contract_audit_trail(contract_id: str) -> list:
        """Get complete audit trail for a specific contract."""
        return await AuditService.query_logs(contract_id=contract_id, limit=1000)
    
    @staticmethod
    async def get_user_activity(user_id: str, days: int = 30) -> list:
        """Get recent activity for a specific user."""
        from datetime import timedelta
        start_date = datetime.utcnow() - timedelta(days=days)
        return await AuditService.query_logs(user_id=user_id, start_date=start_date, limit=500)
