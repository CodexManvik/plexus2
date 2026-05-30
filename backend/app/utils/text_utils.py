"""
Text processing utilities for normalization and fuzzy matching.
"""

import re
from difflib import SequenceMatcher


def normalize_text(text: str) -> str:
    """
    Normalize text for comparison.
    - Lowercase
    - Remove extra whitespace
    - Remove special characters (keep alphanumeric and basic punctuation)
    """
    if not text:
        return ""
    
    # Lowercase
    text = text.lower()
    
    # Replace multiple whitespace with single space
    text = re.sub(r'\s+', ' ', text)
    
    # Remove leading/trailing whitespace
    text = text.strip()
    
    return text


def fuzzy_match_score(text1: str, text2: str) -> float:
    """
    Calculate fuzzy match score between two texts using SequenceMatcher.
    
    Returns:
        Float between 0 and 1, where 1 is exact match
    """
    if not text1 or not text2:
        return 0.0
    
    # Normalize both texts
    norm1 = normalize_text(text1)
    norm2 = normalize_text(text2)
    
    # Use SequenceMatcher for similarity
    return SequenceMatcher(None, norm1, norm2).ratio()


def extract_numbers(text: str) -> list:
    """Extract all numbers from text."""
    if not text:
        return []
    
    # Find all numbers (including decimals)
    numbers = re.findall(r'\d+\.?\d*', text)
    return [float(n) if '.' in n else int(n) for n in numbers]


def extract_dates(text: str) -> list:
    """Extract date-like patterns from text."""
    if not text:
        return []
    
    # Common date patterns
    patterns = [
        r'\d{1,2}[/-]\d{1,2}[/-]\d{2,4}',  # DD/MM/YYYY or MM/DD/YYYY
        r'\d{4}[/-]\d{1,2}[/-]\d{1,2}',    # YYYY-MM-DD
        r'\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}',  # DD Month YYYY
    ]
    
    dates = []
    for pattern in patterns:
        dates.extend(re.findall(pattern, text, re.IGNORECASE))
    
    return dates


def clean_extracted_value(value: str) -> str:
    """Clean extracted value by removing common artifacts."""
    if not value:
        return ""
    
    # Remove leading/trailing quotes
    value = value.strip('"\'')
    
    # Remove leading/trailing whitespace
    value = value.strip()
    
    # Remove common prefixes
    prefixes = ['value:', 'answer:', 'result:']
    for prefix in prefixes:
        if value.lower().startswith(prefix):
            value = value[len(prefix):].strip()
    
    return value
