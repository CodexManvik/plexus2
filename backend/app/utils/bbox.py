"""
Bounding box coordinate utilities.
Rule 6: BBoxOverlay uses normalized coordinates (0-1 scale).
"""

from typing import Tuple, Dict


def normalize_bbox(
    x1: float, y1: float, x2: float, y2: float,
    page_width: float, page_height: float
) -> Tuple[float, float, float, float]:
    """
    Normalize bounding box coordinates to 0-1 scale.
    
    Args:
        x1, y1, x2, y2: Pixel coordinates
        page_width, page_height: Page dimensions in pixels
    
    Returns:
        Normalized coordinates (0-1 scale)
    """
    norm_x1 = x1 / page_width if page_width > 0 else 0
    norm_y1 = y1 / page_height if page_height > 0 else 0
    norm_x2 = x2 / page_width if page_width > 0 else 0
    norm_y2 = y2 / page_height if page_height > 0 else 0
    
    return (norm_x1, norm_y1, norm_x2, norm_y2)


def denormalize_bbox(
    norm_x1: float, norm_y1: float, norm_x2: float, norm_y2: float,
    page_width: float, page_height: float
) -> Tuple[float, float, float, float]:
    """
    Convert normalized coordinates back to pixel coordinates.
    
    Args:
        norm_x1, norm_y1, norm_x2, norm_y2: Normalized coordinates (0-1)
        page_width, page_height: Page dimensions in pixels
    
    Returns:
        Pixel coordinates
    """
    x1 = norm_x1 * page_width
    y1 = norm_y1 * page_height
    x2 = norm_x2 * page_width
    y2 = norm_y2 * page_height
    
    return (x1, y1, x2, y2)


def bbox_to_dict(x1: float, y1: float, x2: float, y2: float) -> Dict[str, float]:
    """Convert bbox tuple to dict."""
    return {
        'x1': x1,
        'y1': y1,
        'x2': x2,
        'y2': y2
    }


def bbox_area(x1: float, y1: float, x2: float, y2: float) -> float:
    """Calculate bounding box area."""
    width = abs(x2 - x1)
    height = abs(y2 - y1)
    return width * height


def bbox_overlap(
    box1: Tuple[float, float, float, float],
    box2: Tuple[float, float, float, float]
) -> float:
    """
    Calculate overlap ratio between two bounding boxes.
    
    Returns:
        Float between 0 and 1, where 1 means complete overlap
    """
    x1_1, y1_1, x2_1, y2_1 = box1
    x1_2, y1_2, x2_2, y2_2 = box2
    
    # Calculate intersection
    x1_i = max(x1_1, x1_2)
    y1_i = max(y1_1, y1_2)
    x2_i = min(x2_1, x2_2)
    y2_i = min(y2_1, y2_2)
    
    if x2_i < x1_i or y2_i < y1_i:
        return 0.0  # No overlap
    
    intersection = bbox_area(x1_i, y1_i, x2_i, y2_i)
    area1 = bbox_area(*box1)
    area2 = bbox_area(*box2)
    
    # Return intersection over minimum area
    min_area = min(area1, area2)
    return intersection / min_area if min_area > 0 else 0.0
