"""
Text processing utilities for normalization and fuzzy matching.
"""

import re
from difflib import SequenceMatcher
from typing import Set


def normalize_text(text: str) -> str:
    """
    Normalize text for comparison.
    - Lowercase
    - Strip punctuation (ligatures, OCR artifacts)
    - Collapse all whitespace to single space
    """
    if not text:
        return ""
    text = text.lower()
    # Remove punctuation except alphanumeric and space
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _token_set(text: str) -> Set[str]:
    """Return the set of normalized word tokens from text."""
    return set(normalize_text(text).split())


def jaccard_similarity(text1: str, text2: str) -> float:
    """
    Compute Jaccard similarity between the word-token sets of two texts.

    Jaccard = |intersection| / |union|

    This is significantly more robust than SequenceMatcher against:
    - OCR whitespace normalization differences
    - Minor word-order variations
    - Partial quotes (the LLM often gives a shorter excerpt)
    """
    if not text1 or not text2:
        return 0.0
    set1 = _token_set(text1)
    set2 = _token_set(text2)
    if not set1 or not set2:
        return 0.0
    intersection = len(set1 & set2)
    union = len(set1 | set2)
    return intersection / union if union else 0.0


def fuzzy_match_score(text1: str, text2: str) -> float:
    """
    Calculate fuzzy match score between two texts.

    Uses the maximum of:
      - SequenceMatcher.ratio() on normalized texts (character-level)
      - Jaccard similarity on word-token sets (vocabulary-level)

    Taking the max ensures a hit on either metric counts as a match —
    a short verbatim quote may score low on SequenceMatcher (length disparity)
    but high on Jaccard (all its words are present in the block).
    """
    if not text1 or not text2:
        return 0.0

    norm1 = normalize_text(text1)
    norm2 = normalize_text(text2)

    seq_score     = SequenceMatcher(None, norm1, norm2).ratio()
    jaccard_score = jaccard_similarity(text1, text2)

    return max(seq_score, jaccard_score)


def extract_numbers(text: str) -> list:
    """Extract all numbers from text."""
    if not text:
        return []
    numbers = re.findall(r"\d+\.?\d*", text)
    return [float(n) if "." in n else int(n) for n in numbers]


def extract_dates(text: str) -> list:
    """Extract date-like patterns from text."""
    if not text:
        return []
    patterns = [
        r"\d{1,2}[/-]\d{1,2}[/-]\d{2,4}",
        r"\d{4}[/-]\d{1,2}[/-]\d{1,2}",
        r"\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}",
    ]
    dates = []
    for pattern in patterns:
        dates.extend(re.findall(pattern, text, re.IGNORECASE))
    return dates


def clean_extracted_value(value: str) -> str:
    """Clean extracted value by removing common artifacts."""
    if not value:
        return ""
    value = value.strip("\"'").strip()
    prefixes = ["value:", "answer:", "result:"]
    for prefix in prefixes:
        if value.lower().startswith(prefix):
            value = value[len(prefix):].strip()
    return value
