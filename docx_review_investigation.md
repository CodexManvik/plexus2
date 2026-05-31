# DOCX Review Pipeline & PDF Conversion Investigation

This document evaluates the UI capabilities for direct DOCX rendering and defines architectural guidelines for high-fidelity server-side PDF conversion within the Plexus Contract Intelligence Platform review workspace.

---

## 1. Frontend UI Capability Audit

The current Plexus Frontend Review Workspace uses a canvas-based grounding coordinate system built on top of `pdf.js` to render contract page layers, draw highlighting bounding boxes (`bbox_x1`, `bbox_y1`, etc.), and handle user selections.

### Direct DOCX Rendering Limitations:
1. **No Browser Native Support:** Standard browsers cannot natively parse or render OpenXML (`.docx`) file structures.
2. **Client-Side Rendering Libraries (e.g., `docx-preview`):** While client-side JavaScript rendering of DOCX exists, it fails to achieve high layout fidelity. It strips headers, footers, advanced numbering layouts, nested tables, and custom margins.
3. **Coordinate Alignment Failure:** A client-side DOCX renderer cannot guarantee that a visual sentence maps exactly to the page coordinates and page numbers estimated or produced during background text extraction. This leads to broken citations (e.g., "Page 17" in extraction mapped to "Page 14" in view).

**Conclusion:** Headless PDF conversion of DOCX files at the ingestion layer remains a strict architectural requirement to support coordinate-based review highlighting.

---

## 2. Server-Side High-Fidelity Conversion Guidelines

To ensure that the canonical review PDF perfectly preserves font layouts, multi-column numbering, tables, and signatures, Plexus should integrate a high-fidelity document converter rather than custom python parsers (e.g. PyMuPDF canvas generation).

### Tier 1 Option: LibreOffice Headless Service (Self-Hosted)
A dockerized LibreOffice service running in headless mode is the industry standard for open-source document conversion.

#### Docker Configuration (Add to `docker-compose.yml`):
```yaml
services:
  soffice-converter:
    image: linuxserver/libreoffice:latest
    container_name: soffice-converter
    ports:
      - "9980:9980"
    restart: unless-stopped
```

#### Python Headless Execution:
```python
import subprocess
import os

def convert_docx_to_pdf(input_path: str, output_dir: str) -> str:
    """Convert DOCX to PDF using headless LibreOffice."""
    cmd = [
        "soffice",
        "--headless",
        "--convert-to", "pdf",
        "--outdir", output_dir,
        input_path
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    filename = os.path.basename(input_path)
    pdf_filename = filename.rsplit(".", 1)[0] + ".pdf"
    return os.path.join(output_dir, pdf_filename)
```

---

## 3. High-Fidelity Enterprise Options

For enterprise cloud-native environments, the platform can offload document conversion to robust managed APIs to guarantee identical legal pagination:

1. **OCI Document Conversion Service:**
   Oracle Cloud Infrastructure (OCI) provides a highly scalable document conversion API that natively converts OpenXML documents to search-optimized, high-fidelity PDFs.
2. **Adobe PDF Services API:**
   Guarantees 100% layout and font parity with Adobe Acrobat desktop renderers.
