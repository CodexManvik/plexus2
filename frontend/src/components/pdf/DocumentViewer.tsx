import { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import api from '../../services/api';
import { useAuthStore } from '../../stores/authStore';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version || '4.0.379'}/build/pdf.worker.min.mjs`;

// ── Types ──────────────────────────────────────────────────────────────────────

interface Grounding {
  page_number: number;
  bbox_x1?: number;
  bbox_y1?: number;
  bbox_x2?: number;
  bbox_y2?: number;
  source_text: string;
}

interface Parameter {
  param_id: string;
  parameter_name: string;
  parameter_group: string;
  extracted_value: string;
  supporting_text: string;
  confidence: number;
  validation_status: string;
  edited_value: string | null;
  reviewer_status: string | null;
  grounding?: Grounding | null;
}

interface DocumentViewerProps {
  contractId: string;
  activeParamId: string | null;
  parameters: Parameter[];
  onParamClick: (paramId: string) => void;
}

// ── Utility: escape text for use in a regex ───────────────────────────────────
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Utility: highlight source_text occurrences inside rendered DOCX HTML ──────
function applyTextHighlights(
  container: HTMLElement,
  parameters: Parameter[],
  activeParamId: string | null
): void {
  // Walk all text nodes and wrap matching phrases in <mark> elements.
  // We process active param first so its highlight takes precedence.
  const sorted = [...parameters].sort((a, b) =>
    a.param_id === activeParamId ? -1 : b.param_id === activeParamId ? 1 : 0
  );

  for (const param of sorted) {
    const text = param.grounding?.source_text || param.supporting_text;
    if (!text || text.trim().length < 5) continue;

    const isActive = param.param_id === activeParamId;
    const markClass = isActive
      ? 'plexus-highlight-active'
      : 'plexus-highlight-inactive';

    // Use TreeWalker to find text nodes
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      textNodes.push(node);
    }

    const needle = text.trim().slice(0, 300);
    const regex = new RegExp(`(${escapeRegex(needle)})`, 'i');

    for (const tn of textNodes) {
      if (!tn.nodeValue) continue;
      const match = regex.exec(tn.nodeValue);
      if (!match) continue;

      const before = tn.nodeValue.slice(0, match.index);
      const matched = match[0];
      const after = tn.nodeValue.slice(match.index + matched.length);

      const mark = document.createElement('mark');
      mark.className = markClass;
      mark.dataset.paramId = param.param_id;
      mark.textContent = matched;

      const frag = document.createDocumentFragment();
      if (before) frag.appendChild(document.createTextNode(before));
      frag.appendChild(mark);
      if (after) frag.appendChild(document.createTextNode(after));

      tn.parentNode?.replaceChild(frag, tn);
      break; // Only highlight first occurrence per param
    }
  }
}

// ── PDF Sub-viewer ────────────────────────────────────────────────────────────

interface PDFSubViewerProps {
  fileUrl: string;
  requiresAuthHeader: boolean;
  activeParamId: string | null;
  parameters: Parameter[];
  onParamClick: (paramId: string) => void;
}

function PDFSubViewer({
  fileUrl,
  requiresAuthHeader,
  activeParamId,
  parameters,
  onParamClick,
}: PDFSubViewerProps) {
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.25);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const { accessToken } = useAuthStore.getState();
    const loadingTask = pdfjsLib.getDocument({
      url: fileUrl,
      withCredentials: false,
      httpHeaders:
        requiresAuthHeader && accessToken
          ? { Authorization: `Bearer ${accessToken}` }
          : {},
    });

    loadingTask.promise.then(
      (doc) => {
        if (!active) return;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setLoading(false);
      },
      (err) => {
        if (!active) return;
        console.error('PDF load error:', err);
        setError(err.message || 'Failed to load PDF.');
        setLoading(false);
      }
    );

    return () => {
      active = false;
    };
  }, [fileUrl, requiresAuthHeader]);

  // Sync page to active parameter grounding
  useEffect(() => {
    if (!activeParamId || parameters.length === 0) return;
    const p = parameters.find((x) => x.param_id === activeParamId);
    if (p?.grounding?.page_number) {
      setPageNumber(p.grounding.page_number);
    }
  }, [activeParamId, parameters]);

  const drawBoundingBoxes = useCallback(
    (width: number, height: number) => {
      const canvas = overlayCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.clearRect(0, 0, width, height);

      const pageParams = parameters.filter(
        (p) => p.grounding && p.grounding.page_number === pageNumber
      );

      pageParams.forEach((param) => {
        const g = param.grounding!;
        if (
          g.bbox_x1 === undefined ||
          g.bbox_y1 === undefined ||
          g.bbox_x2 === undefined ||
          g.bbox_y2 === undefined
        )
          return;

        const x = g.bbox_x1 * width;
        const y = g.bbox_y1 * height;
        const w = (g.bbox_x2 - g.bbox_x1) * width;
        const h = (g.bbox_y2 - g.bbox_y1) * height;
        const isActive = param.param_id === activeParamId;

        if (isActive) {
          ctx.strokeStyle = '#2563eb';
          ctx.fillStyle = 'rgba(37,99,235,0.12)';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([]);
          ctx.fillRect(x, y, w, h);
          ctx.strokeRect(x, y, w, h);

          ctx.fillStyle = '#2563eb';
          ctx.font = 'bold 9px Inter,sans-serif';
          const lw = ctx.measureText(param.parameter_name).width;
          ctx.fillRect(x, Math.max(0, y - 14), lw + 8, 14);
          ctx.fillStyle = '#fff';
          ctx.fillText(param.parameter_name, x + 4, Math.max(10, y - 4));
        } else {
          ctx.strokeStyle = 'rgba(37,99,235,0.3)';
          ctx.fillStyle = 'rgba(37,99,235,0.04)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.fillRect(x, y, w, h);
          ctx.strokeRect(x, y, w, h);
        }
      });
    },
    [parameters, pageNumber, activeParamId]
  );

  const renderPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current) return;
    try {
      if (renderTaskRef.current) renderTaskRef.current.cancel();
      const page = await pdfDoc.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const task = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      await task.promise;
      drawBoundingBoxes(viewport.width, viewport.height);
    } catch (err: any) {
      if (err.name !== 'RenderingCancelledException') {
        console.error('Render error:', err);
      }
    }
  }, [pdfDoc, pageNumber, scale, drawBoundingBoxes]);

  useEffect(() => {
    renderPage();
  }, [renderPage]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const normX = (e.clientX - rect.left) / rect.width;
    const normY = (e.clientY - rect.top) / rect.height;
    const hit = parameters.find((param) => {
      const g = param.grounding;
      if (!g || g.page_number !== pageNumber) return false;
      if (
        g.bbox_x1 === undefined ||
        g.bbox_y1 === undefined ||
        g.bbox_x2 === undefined ||
        g.bbox_y2 === undefined
      )
        return false;
      return (
        normX >= g.bbox_x1 &&
        normX <= g.bbox_x2 &&
        normY >= g.bbox_y1 &&
        normY <= g.bbox_y2
      );
    });
    if (hit) onParamClick(hit.param_id);
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-500">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-medium">Loading PDF...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-red-500 px-8 text-center">
        <span className="material-symbols-outlined text-5xl">broken_image</span>
        <p className="font-semibold text-sm">{error}</p>
        <p className="text-xs text-slate-400">Check that the contract file exists on disk and the server is reachable.</p>
      </div>
    );
  }

  return (
    <>
      {/* Toolbar */}
      <div className="h-10 border-b border-slate-200 bg-white flex items-center justify-between px-4 shrink-0 select-none">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
            disabled={pageNumber <= 1}
            className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">chevron_left</span>
          </button>
          <span className="text-xs font-bold text-slate-600 tabular-nums">
            {pageNumber} / {numPages}
          </span>
          <button
            onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
            disabled={pageNumber >= numPages}
            className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">chevron_right</span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setScale((s) => Math.max(0.5, s - 0.2))} className="p-1 rounded hover:bg-slate-100 transition-colors">
            <span className="material-symbols-outlined text-[18px]">zoom_out</span>
          </button>
          <span className="text-xs font-bold text-slate-600 w-10 text-center tabular-nums">{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale((s) => Math.min(3, s + 0.2))} className="p-1 rounded hover:bg-slate-100 transition-colors">
            <span className="material-symbols-outlined text-[18px]">zoom_in</span>
          </button>
        </div>
      </div>

      {/* Canvas scroll area */}
      <div className="flex-1 overflow-auto p-6 flex flex-col items-center bg-slate-100">
        <div
          className="relative shadow-xl rounded bg-white"
          style={{
            width: canvasRef.current?.width || 'auto',
            height: canvasRef.current?.height || 'auto',
          }}
        >
          <canvas ref={canvasRef} className="block" />
          <canvas
            ref={overlayCanvasRef}
            className="absolute top-0 left-0 cursor-pointer"
            onClick={handleCanvasClick}
          />
        </div>
      </div>
    </>
  );
}

// ── DOCX Sub-viewer ───────────────────────────────────────────────────────────

interface RichDocViewerProps {
  fileUrl: string;
  requiresAuthHeader: boolean;
  activeParamId: string | null;
  parameters: Parameter[];
  onParamClick: (paramId: string) => void;
  fileType: 'docx' | 'xlsx';
}

function RichDocViewer({
  fileUrl,
  requiresAuthHeader,
  activeParamId,
  parameters,
  onParamClick,
  fileType,
}: RichDocViewerProps) {
  const [html, setHtml] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const { accessToken } = useAuthStore.getState();
    const headers: Record<string, string> = {};
    if (requiresAuthHeader && accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    fetch(fileUrl, { headers })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
        return res.arrayBuffer();
      })
      .then(async (buffer) => {
        if (!active) return;
        if (fileType === 'docx') {
          // Dynamic import so the bundle doesn't always load mammoth
          const mammoth = await import('mammoth');
          const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
          if (active) setHtml(result.value);
        } else {
          // xlsx
          const XLSX = await import('xlsx');
          const wb = XLSX.read(buffer, { type: 'array' });
          const sheetName = wb.SheetNames[0];
          const sheet = wb.Sheets[sheetName];
          const tableHtml = XLSX.utils.sheet_to_html(sheet, { editable: false });
          if (active) setHtml(tableHtml);
        }
        if (active) setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        console.error('Document load error:', err);
        setError(err.message || 'Failed to load document.');
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [fileUrl, requiresAuthHeader, fileType]);

  // Re-apply highlights whenever content, parameters, or active param changes
  useEffect(() => {
    if (!containerRef.current || !html) return;
    // Clear previous marks to avoid nesting on re-render
    containerRef.current.querySelectorAll('mark.plexus-highlight-active, mark.plexus-highlight-inactive').forEach((m) => {
      const parent = m.parentNode;
      if (!parent) return;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    });
    applyTextHighlights(containerRef.current, parameters, activeParamId);
  }, [html, parameters, activeParamId]);

  // Clicking a highlight selects the parameter
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const mark = (e.target as HTMLElement).closest('mark[data-param-id]');
    if (mark) {
      const paramId = (mark as HTMLElement).dataset.paramId;
      if (paramId) onParamClick(paramId);
    }
  };

  // Scroll to active highlight
  useEffect(() => {
    if (!containerRef.current || !activeParamId) return;
    const mark = containerRef.current.querySelector(
      `mark[data-param-id="${activeParamId}"]`
    ) as HTMLElement | null;
    if (mark) {
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeParamId, html]);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-500">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-medium">
          {fileType === 'docx' ? 'Converting DOCX…' : 'Loading spreadsheet…'}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-red-500 px-8 text-center">
        <span className="material-symbols-outlined text-5xl">broken_image</span>
        <p className="font-semibold text-sm">{error}</p>
        <p className="text-xs text-slate-400">
          Ensure the backend server is running and the file exists on disk.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-auto bg-slate-50 p-6"
      onClick={handleClick}
    >
      <div
        ref={containerRef}
        className="plexus-doc-body mx-auto max-w-4xl bg-white shadow-lg rounded-lg p-10 text-sm leading-relaxed"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

// ── Main DocumentViewer ───────────────────────────────────────────────────────

export default function DocumentViewer({
  contractId,
  activeParamId,
  parameters,
  onParamClick,
}: DocumentViewerProps) {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileType, setFileType] = useState<'pdf' | 'docx' | 'xlsx'>('pdf');
  const [requiresAuthHeader, setRequiresAuthHeader] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    api
      .get(`/contracts/${contractId}/pdf-url`)
      .then(({ data }) => {
        if (!active) return;
        if (!data?.url) throw new Error('No file URL returned by backend.');
        setFileUrl(data.url);
        setFileType(data.file_type || 'pdf');
        setRequiresAuthHeader(data.requires_auth_header !== false);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        console.error('Failed to fetch document URL:', err);
        setError(err.response?.data?.detail || err.message || 'Failed to load document.');
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [contractId]);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-500">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-medium">Loading document info…</p>
      </div>
    );
  }

  if (error || !fileUrl) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-red-500 px-8 text-center">
        <span className="material-symbols-outlined text-5xl">broken_image</span>
        <p className="font-semibold text-sm">{error || 'No document URL available.'}</p>
        <p className="text-xs text-slate-400">Check that the backend is running and authenticated.</p>
      </div>
    );
  }

  if (fileType === 'pdf') {
    return (
      <PDFSubViewer
        fileUrl={fileUrl}
        requiresAuthHeader={requiresAuthHeader}
        activeParamId={activeParamId}
        parameters={parameters}
        onParamClick={onParamClick}
      />
    );
  }

  return (
    <RichDocViewer
      fileUrl={fileUrl}
      requiresAuthHeader={requiresAuthHeader}
      activeParamId={activeParamId}
      parameters={parameters}
      onParamClick={onParamClick}
      fileType={fileType}
    />
  );
}
