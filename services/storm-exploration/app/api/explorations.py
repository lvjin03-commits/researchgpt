from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response, status

from app.domain.contracts import ExplorationRequest, ExplorationResult, StartResponse, StatusResponse
from app.service import ExplorationConflict, ExplorationNotFound, ExplorationService


router = APIRouter(prefix="/v1/explorations", tags=["explorations"])


def service_from(request: Request) -> ExplorationService:
    return request.app.state.exploration_service


@router.post("", response_model=StartResponse, status_code=status.HTTP_202_ACCEPTED)
def start_exploration(payload: ExplorationRequest, request: Request) -> StartResponse:
    try:
        return service_from(request).start(payload)
    except ExplorationConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.get("/{remote_execution_id}", response_model=StatusResponse)
def get_status(remote_execution_id: str, request: Request) -> StatusResponse:
    try:
        return service_from(request).status(remote_execution_id)
    except ExplorationNotFound as error:
        raise HTTPException(status_code=404, detail="exploration not found") from error


@router.post("/{remote_execution_id}/cancel", response_model=StatusResponse)
def cancel(remote_execution_id: str, request: Request) -> StatusResponse:
    try:
        return service_from(request).cancel(remote_execution_id)
    except ExplorationNotFound as error:
        raise HTTPException(status_code=404, detail="exploration not found") from error


@router.get("/{remote_execution_id}/result", response_model=ExplorationResult)
def get_result(remote_execution_id: str, request: Request, response: Response) -> ExplorationResult:
    try:
        result = service_from(request).result(remote_execution_id)
    except ExplorationNotFound as error:
        raise HTTPException(status_code=404, detail="exploration not found") from error
    if result is None:
        raise HTTPException(status_code=409, detail="exploration result is not ready")
    response.headers["Cache-Control"] = "private, no-store"
    return result
