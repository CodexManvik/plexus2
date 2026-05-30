import { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import api from '../../services/api';

// Set worker source using a stable, fast unpkg CDN matching the installed version
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version || '4.0.379'}/build/pdf.worker.min.mjs`;

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

interface PDFViewerProps {
  contractId: string;
  activeParamId: string | null;
  parameters: Parameter[];
  onParamClick: (paramId: string) => void;
}

export default function PDFViewer({ contractId, activeParamId, parameters, onParamClick }: PDFViewerProps) {
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.25);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null);

  // Fetch the PDF URL and load the document
  useEffect(() => {
    let active = true;
    const loadPDF = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await api.get(`/contracts/${contractId}/pdf-url`);
        if (!data?.url) {
          throw new Error('No PDF URL returned by backend.');
        }

        if (!active) return;

        const loadingTask = pdfjsLib.getDocument({
          url: data.url,
          withCredentials: false
        });

        const doc = await loadingTask.promise;
        if (!active) return;

        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setLoading(false);
      } catch (err: any) {
        console.error('Error loading PDF:', err);
        if (active) {
          setError(err.message || 'Failed to load PDF document.');
          setLoading(false);
        }
      }
    };

    loadPDF();
    return () => {
      active = false;
    };
  }, [contractId]);

  // Synchronize current page with active parameter's grounding page
  useEffect(() => {
    if (!activeParamId || parameters.length === 0) return;
    const activeParam = parameters.find(p => p.param_id === activeParamId);
    if (activeParam?.grounding?.page_number) {
      setPageNumber(activeParam.grounding.page_number);
    }
  }, [activeParamId, parameters]);

  // Draw overlay bounding boxes
  const drawBoundingBoxes = (width: number, height: number) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.clearRect(0, 0, width, height);

    // Filter parameters grounded to the current page
    const pageParams = parameters.filter(
      p => p.grounding && p.grounding.page_number === pageNumber
    );

    pageParams.forEach(param => {
      const g = param.grounding!;
      if (
        g.bbox_x1 === undefined ||
        g.bbox_y1 === undefined ||
        g.bbox_x2 === undefined ||
        g.bbox_y2 === undefined
      ) {
        return;
      }

      const x = g.bbox_x1 * width;
      const y = g.bbox_y1 * height;
      const w = (g.bbox_x2 - g.bbox_x1) * width;
      const h = (g.bbox_y2 - g.bbox_y1) * height;

      const isActive = param.param_id === activeParamId;

      if (isActive) {
        // Highlight active parameter in solid navy/blue with soft backdrop fill
        ctx.strokeStyle = '#041627';
        ctx.fillStyle = 'rgba(210, 228, 251, 0.4)';
        ctx.lineWidth = 3;
        ctx.setLineDash([]);
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);

        // Draw a neat label on top of the highlight box
        ctx.fillStyle = '#041627';
        ctx.font = 'bold 10px Inter, sans-serif';
        const labelText = param.parameter_name;
        const textWidth = ctx.measureText(labelText).width;
        ctx.fillRect(x, Math.max(0, y - 14), textWidth + 8, 14);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(labelText, x + 4, Math.max(10, y - 4));
      } else {
        // Subtle outline and fill for inactive groundings
        ctx.strokeStyle = 'rgba(4, 22, 39, 0.35)';
        ctx.fillStyle = 'rgba(4, 22, 39, 0.04)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
      }
    });
  };

  // Render the current page onto the canvas
  const renderPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current) return;

    try {
      // Cancel pending render task to avoid race conditions
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }

      const page = await pdfDoc.getPage(pageNumber);
      const viewport = page.getViewport({ scale });

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const renderContext = {
        canvasContext: ctx,
        viewport: viewport
      };

      const renderTask = page.render(renderContext);
      renderTaskRef.current = renderTask;
      await renderTask.promise;

      // Draw bounding boxes on the overlay canvas once rendering finishes
      drawBoundingBoxes(viewport.width, viewport.height);
    } catch (err: any) {
      if (err.name !== 'RenderingCancelledException') {
        console.error('Error rendering page:', err);
      }
    }
  }, [pdfDoc, pageNumber, scale, parameters, activeParamId]);

  // Redraw when page or scale changes, or when parameters list / active parameter updates
  useEffect(() => {
    renderPage();
  }, [renderPage]);

  // Bidirectional interaction: clicking a bounding box selects the parameter
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const normX = clickX / rect.width;
    const normY = clickY / rect.height;

    // Find if click hits any grounded parameter bbox on this page
    const hitParam = parameters.find(param => {
      const g = param.grounding;
      if (!g || g.page_number !== pageNumber) return false;
      if (
        g.bbox_x1 === undefined ||
        g.bbox_y1 === undefined ||
        g.bbox_x2 === undefined ||
        g.bbox_y2 === undefined
      ) {
        return false;
      }
      return (
        normX >= g.bbox_x1 &&
        normX <= g.bbox_x2 &&
        normY >= g.bbox_y1 &&
        normY <= g.bbox_y2
      );
    });

    if (hitParam) {
      onParamClick(hitParam.param_id);
    }
  };

  const handlePrevPage = () => {
    if (pageNumber > 1) {
      setPageNumber(prev => prev - 1);
    }
  };

  const handleNextPage = () => {
    if (pageNumber < numPages) {
      setPageNumber(prev => prev + 1);
    }
  };

  const handleZoomOut = () => {
    setScale(prev => Math.max(0.6, prev - 0.2));
  };

  const handleZoomIn = () => {
    setScale(prev => Math.min(3.0, prev + 0.2));
  };

  if (loading) {
    return (
      <div className="w-full flex-1 flex flex-col items-center justify-center p-xl text-on-surface-variant font-body-md gap-md min-h-[500px]">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
        <p className="font-bold">Loading contract document...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full flex-1 flex flex-col items-center justify-center p-xl text-error font-body-md gap-md min-h-[500px]">
        <span className="material-symbols-outlined text-[48px]">error</span>
        <div className="text-center">
          <p className="font-bold">{error}</p>
          <p className="text-sm opacity-80 mt-xs">Verify local storage uploads/ or OCI credentials.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full flex-1 flex flex-col overflow-hidden bg-surface-dim">
      {/* Sub-navigation Controls bar */}
      <div className="h-10 border-b border-outline-variant bg-surface flex items-center justify-between px-md shrink-0 select-none">
        <div className="flex items-center gap-sm">
          <span className="bg-surface-container-highest text-on-surface-variant px-xs py-0.5 rounded text-[10px] uppercase font-bold tracking-wider">
            Page {pageNumber} of {numPages}
          </span>
        </div>
        
        {/* Navigation buttons */}
        <div className="flex items-center gap-sm">
          <button 
            onClick={handlePrevPage}
            disabled={pageNumber <= 1}
            className="p-1 hover:bg-surface-container-high rounded disabled:opacity-30"
          >
            <span className="material-symbols-outlined text-[20px]">chevron_left</span>
          </button>
          <span className="font-label-md text-label-md font-bold px-1">{pageNumber} / {numPages}</span>
          <button 
            onClick={handleNextPage}
            disabled={pageNumber >= numPages}
            className="p-1 hover:bg-surface-container-high rounded disabled:opacity-30"
          >
            <span className="material-symbols-outlined text-[20px]">chevron_right</span>
          </button>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-md">
          <button onClick={handleZoomOut} className="p-1 hover:bg-surface-container-high rounded">
            <span className="material-symbols-outlined text-[20px]">zoom_out</span>
          </button>
          <span className="font-label-md text-label-md font-bold w-12 text-center">{Math.round(scale * 100)}%</span>
          <button onClick={handleZoomIn} className="p-1 hover:bg-surface-container-high rounded">
            <span className="material-symbols-outlined text-[20px]">zoom_in</span>
          </button>
        </div>
      </div>

      {/* PDF Pages rendering scrollarea */}
      <div className="flex-1 overflow-auto p-xl flex flex-col items-center custom-scrollbar">
        <div className="relative pdf-page-shadow bg-white" style={{ width: canvasRef.current?.width || 'auto', height: canvasRef.current?.height || 'auto' }}>
          {/* Base PDF Page Canvas */}
          <canvas ref={canvasRef} className="block" />
          
          {/* Overlay interactive canvas for bboxes */}
          <canvas 
            ref={overlayCanvasRef} 
            className="absolute top-0 left-0 cursor-pointer"
            onClick={handleCanvasClick}
          />
        </div>
      </div>
    </div>
  );
}
