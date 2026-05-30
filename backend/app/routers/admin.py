"""
Admin router — Parameter Schema CRUD.
All endpoints restricted to the 'admin' role.
Replaces the localStorage-based schema management in the frontend Admin page.
"""

from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
import uuid

from ..auth.dependencies import require_role
from ..auth.models import UserRole
from ..database import db_pool
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["Admin"])


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class ParameterSchemaCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    logic: Optional[str] = Field(None, max_length=500)
    contract_types: Optional[str] = Field(None, max_length=500)
    category: Literal["Commercial", "Vendor", "Internal"] = "Commercial"
    priority: Literal["High", "Med", "Low"] = "High"


class ParameterSchemaUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    logic: Optional[str] = Field(None, max_length=500)
    contract_types: Optional[str] = Field(None, max_length=500)
    category: Optional[Literal["Commercial", "Vendor", "Internal"]] = None
    priority: Optional[Literal["High", "Med", "Low"]] = None


class ParameterSchemaResponse(BaseModel):
    schema_id: str
    name: str
    logic: Optional[str]
    contract_types: Optional[str]
    category: Optional[str]
    priority: Optional[str]
    created_by: Optional[str]
    created_at: Optional[str]
    updated_at: Optional[str]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _row_to_dict(row) -> dict:
    return {
        "schema_id":     row[0],
        "name":          row[1],
        "logic":         row[2],
        "contract_types": row[3],
        "category":      row[4],
        "priority":      row[5],
        "created_by":    row[6],
        "created_at":    str(row[7]) if row[7] else None,
        "updated_at":    str(row[8]) if row[8] else None,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get(
    "/parameter-schemas",
    response_model=List[ParameterSchemaResponse],
    summary="List all parameter extraction schemas"
)
async def list_parameter_schemas(
    current_user: dict = Depends(require_role(UserRole.ADMIN))
):
    """Return all parameter schemas ordered by priority then name."""
    query = """
        SELECT schema_id, name, logic, contract_types, category, priority,
               created_by, created_at, updated_at
        FROM parameter_schemas
        ORDER BY
            CASE priority WHEN 'High' THEN 1 WHEN 'Med' THEN 2 ELSE 3 END,
            name
    """
    async with db_pool.get_connection() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute(query)
            rows = await cursor.fetchall()
            return [_row_to_dict(r) for r in rows]


@router.post(
    "/parameter-schemas",
    response_model=ParameterSchemaResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new parameter schema"
)
async def create_parameter_schema(
    payload: ParameterSchemaCreate,
    current_user: dict = Depends(require_role(UserRole.ADMIN))
):
    """Insert a new parameter schema and return the created record."""
    schema_id = uuid.uuid4().hex.upper()
    user_id   = current_user["user_id"]

    insert_sql = """
        INSERT INTO parameter_schemas
            (schema_id, name, logic, contract_types, category, priority, created_by)
        VALUES
            (HEXTORAW(:schema_id), :name, :logic, :contract_types,
             :category, :priority, HEXTORAW(:created_by))
    """
    select_sql = """
        SELECT schema_id, name, logic, contract_types, category, priority,
               created_by, created_at, updated_at
        FROM parameter_schemas
        WHERE schema_id = HEXTORAW(:schema_id)
    """

    async with db_pool.get_connection() as conn:
        async with conn.cursor() as cursor:
            try:
                await cursor.execute(insert_sql, {
                    "schema_id":     schema_id,
                    "name":          payload.name,
                    "logic":         payload.logic,
                    "contract_types": payload.contract_types,
                    "category":      payload.category,
                    "priority":      payload.priority,
                    "created_by":    user_id,
                })
                await conn.commit()
            except Exception as e:
                logger.error(f"Failed to insert parameter schema: {e}")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to create parameter schema"
                )

            await cursor.execute(select_sql, {"schema_id": schema_id})
            row = await cursor.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Schema created but could not be retrieved"
                )
            return _row_to_dict(row)


@router.put(
    "/parameter-schemas/{schema_id}",
    response_model=ParameterSchemaResponse,
    summary="Update an existing parameter schema"
)
async def update_parameter_schema(
    schema_id: str,
    payload: ParameterSchemaUpdate,
    current_user: dict = Depends(require_role(UserRole.ADMIN))
):
    """Partially update a parameter schema by schema_id."""
    # Fetch current values first
    select_sql = """
        SELECT schema_id, name, logic, contract_types, category, priority,
               created_by, created_at, updated_at
        FROM parameter_schemas
        WHERE schema_id = HEXTORAW(:schema_id)
    """
    async with db_pool.get_connection() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute(select_sql, {"schema_id": schema_id})
            row = await cursor.fetchone()

        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schema not found")

        current = _row_to_dict(row)

        # Merge payload with current values
        updated_name          = payload.name          if payload.name          is not None else current["name"]
        updated_logic         = payload.logic         if payload.logic         is not None else current["logic"]
        updated_contract_types = payload.contract_types if payload.contract_types is not None else current["contract_types"]
        updated_category      = payload.category      if payload.category      is not None else current["category"]
        updated_priority      = payload.priority      if payload.priority      is not None else current["priority"]

        update_sql = """
            UPDATE parameter_schemas
            SET name           = :name,
                logic          = :logic,
                contract_types = :contract_types,
                category       = :category,
                priority       = :priority,
                updated_at     = CURRENT_TIMESTAMP
            WHERE schema_id = HEXTORAW(:schema_id)
        """

        async with conn.cursor() as cursor:
            try:
                await cursor.execute(update_sql, {
                    "schema_id":      schema_id,
                    "name":           updated_name,
                    "logic":          updated_logic,
                    "contract_types":  updated_contract_types,
                    "category":       updated_category,
                    "priority":       updated_priority,
                })
                await conn.commit()
            except Exception as e:
                logger.error(f"Failed to update parameter schema {schema_id}: {e}")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to update parameter schema"
                )

            await cursor.execute(select_sql, {"schema_id": schema_id})
            row = await cursor.fetchone()
            return _row_to_dict(row)


@router.delete(
    "/parameter-schemas/{schema_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a parameter schema"
)
async def delete_parameter_schema(
    schema_id: str,
    current_user: dict = Depends(require_role(UserRole.ADMIN))
):
    """Delete a parameter schema by schema_id."""
    delete_sql = """
        DELETE FROM parameter_schemas
        WHERE schema_id = HEXTORAW(:schema_id)
    """
    async with db_pool.get_connection() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute(delete_sql, {"schema_id": schema_id})
            if cursor.rowcount == 0:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schema not found")
            await conn.commit()
