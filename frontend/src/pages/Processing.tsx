/**
 * Processing.tsx — Live extraction pipeline status page.
 *
 * Connects to the backend WebSocket at /ws/extraction/{contractId} and
 * streams real pipeline events.  Falls back gracefully if WS is unavailable.
 *
 * URL: /processing/:contractId
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

interface PipelineEvent {
  stage: string;
  message: string;
  progress?: number | null;
  batch?: string;
  timestamp: string;
}

const STAGE_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  CONNECTED:          { label: 'Connected',            icon: 'wifi',             color: 'text-blue-500' },
  EXTRACTION_RUNNING: { label: 'Extracting Parameters', icon: 'psychology',       color: 'text-indigo-500' },
  GROUNDING_RUNNING:  { label: 'Grounding Evidence',   icon: 'pin_drop',         color: 'text-violet-500' },
  VALIDATION_RUNNING: { label: 'Running Validation',   icon: 'rule',             color: 'text-amber-500' },
  DRAFT_READY:        { label: 'Draft Ready',           icon: 'task_alt',         color: 'text-emerald-500' },
  ERROR:              { label: 'Pipeline Error',        icon: 'error',            color: 'text-red-500' },
  HEARTBEAT:          { label: 'Pipeline Active',       icon: 'favorite',         color: 'text-slate-400' },
};

const WS_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8000')
  .replace(/^http/, 'ws');

const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECTS = 4;

export default function Processing() {
  const { contractId } = useParams<{ contractId: string }>();
  const navigate = useNavigate();
  const { accessToken } = useAuthStore();

  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [progress, setProgress] = useState<number>(0);
  const [currentStage, setCurrentStage] = useState<string>('CONNECTING');
  const [isTerminal, setIsTerminal] = useState<boolean>(false);
  const [wsError, setWsError] = useState<string | null>(null);

  const wsRef         = useRef<WebSocket | null>(null);
  const reconnectsRef = useRef<number>(0);
  const eventListRef  = useRef<HTMLDivElement>(null);

  const pushEvent = useCallback((evt: PipelineEvent) => {
    setEvents(prev => [...prev, evt]);
    if (evt.progress != null) {
      setProgress(Math.round(evt.progress * 100));
    }
    if (evt.stage !== 'HEARTBEAT') {
      setCurrentStage(evt.stage);
    }
    // Auto-scroll log
    setTimeout(() => {
      eventListRef.current?.scrollTo({ top: eventListRef.current.scrollHeight, behavior: 'smooth' });
    }, 50);
  }, []);

  const connect = useCallback(() => {
    if (!contractId || !accessToken) return;
    if (reconnectsRef.current > MAX_RECONNECTS) {
      setWsError('Lost connection to the pipeline. Please refresh.');
      return;
    }

    const url = `${WS_BASE}/ws/extraction/${contractId}?token=${encodeURIComponent(accessToken)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const evt: PipelineEvent = JSON.parse(e.data);
        pushEvent(evt);
        if (evt.stage === 'DRAFT_READY' || evt.stage === 'ERROR') {
          setIsTerminal(true);
        }
      } catch {
        // malformed frame — ignore
      }
    };

    ws.onerror = () => {
      setWsError('WebSocket connection error. Retrying...');
    };

    ws.onclose = (e) => {
      if (isTerminal) return; // Clean close after terminal event
      if (e.code === 1008) {
        setWsError('Authentication failed. Please log in again.');
        return;
      }
      // Attempt reconnect
      reconnectsRef.current++;
      setTimeout(connect, RECONNECT_DELAY_MS);
    };
  }, [contractId, accessToken, pushEvent, isTerminal]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  const stageInfo = STAGE_CONFIG[currentStage] ?? {
    label: currentStage,
    icon: 'hourglass_top',
    color: 'text-slate-500',
  };

  const handleGoToReview = () => {
    navigate(`/review/${contractId}`);
  };

  return (
    <main className="flex-1 flex flex-col items-center justify-start p-xl gap-xl bg-surface-dim min-h-[calc(100vh-3.5rem)] overflow-auto">

      {/* Header */}
      <div className="w-full max-w-2xl">
        <h1 className="font-headline text-headline-sm text-on-surface font-bold mb-xs">
          Extraction Pipeline
        </h1>
        <p className="text-body-md text-on-surface-variant">
          Contract <code className="font-mono bg-surface-container px-xs rounded text-sm">{contractId}</code>
        </p>
      </div>

      {/* Stage Card */}
      <div className="w-full max-w-2xl bg-surface rounded-2xl shadow-sm border border-outline-variant p-xl flex flex-col gap-lg">

        {/* Active stage indicator */}
        <div className="flex items-center gap-md">
          <div className={`w-12 h-12 rounded-full bg-surface-container flex items-center justify-center ${stageInfo.color} shrink-0`}>
            <span className={`material-symbols-outlined text-2xl ${currentStage === 'EXTRACTION_RUNNING' && !isTerminal ? 'animate-spin-slow' : ''}`}>
              {stageInfo.icon}
            </span>
          </div>
          <div>
            <div className="font-label-lg text-label-lg font-bold text-on-surface">{stageInfo.label}</div>
            {events.length > 0 && (
              <div className="text-body-sm text-on-surface-variant">
                {events[events.length - 1].message}
              </div>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex flex-col gap-xs">
          <div className="flex justify-between text-[11px] font-mono font-bold text-on-surface-variant">
            <span>PIPELINE PROGRESS</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full h-2 bg-surface-container-highest rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Stage steps */}
        <div className="grid grid-cols-4 gap-sm">
          {(['EXTRACTION_RUNNING', 'GROUNDING_RUNNING', 'VALIDATION_RUNNING', 'DRAFT_READY'] as const).map((stage, idx) => {
            const stageOrder = ['EXTRACTION_RUNNING', 'GROUNDING_RUNNING', 'VALIDATION_RUNNING', 'DRAFT_READY'];
            const currentIdx = stageOrder.indexOf(currentStage);
            const isDone    = currentIdx > idx || (isTerminal && currentIdx === stageOrder.indexOf('DRAFT_READY'));
            const isActive  = currentStage === stage;
            return (
              <div key={stage} className={`flex flex-col items-center gap-xs p-sm rounded-xl border text-center transition-all ${
                isDone   ? 'border-emerald-200 bg-emerald-50' :
                isActive ? 'border-primary/30 bg-primary/5'   :
                           'border-outline-variant bg-transparent'
              }`}>
                <span className={`material-symbols-outlined text-lg ${
                  isDone ? 'text-emerald-600' : isActive ? 'text-primary' : 'text-on-surface-variant/40'
                }`}>
                  {isDone ? 'check_circle' : STAGE_CONFIG[stage].icon}
                </span>
                <span className={`text-[10px] font-bold uppercase leading-tight ${
                  isDone ? 'text-emerald-700' : isActive ? 'text-primary' : 'text-on-surface-variant/40'
                }`}>
                  {STAGE_CONFIG[stage].label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Error banner */}
        {wsError && (
          <div className="flex items-center gap-sm px-md py-sm bg-error-container/40 border border-error/20 rounded-lg text-error text-body-sm font-bold">
            <span className="material-symbols-outlined text-lg">warning</span>
            {wsError}
          </div>
        )}

        {/* CTA — only shown when pipeline completes */}
        {isTerminal && currentStage === 'DRAFT_READY' && (
          <button
            onClick={handleGoToReview}
            className="mt-sm w-full py-3 bg-primary text-on-primary font-label-lg text-label-lg rounded-xl shadow hover:opacity-90 active:scale-95 transition-all font-bold"
          >
            Go to Draft Review
          </button>
        )}
        {isTerminal && currentStage === 'ERROR' && (
          <button
            onClick={() => navigate('/dashboard')}
            className="mt-sm w-full py-3 border border-error text-error font-label-lg text-label-lg rounded-xl hover:bg-error/5 transition-all font-bold"
          >
            Back to Dashboard
          </button>
        )}
      </div>

      {/* Event log */}
      <div className="w-full max-w-2xl bg-surface rounded-2xl border border-outline-variant overflow-hidden">
        <div className="px-md py-sm border-b border-outline-variant bg-surface-container-low flex items-center gap-sm">
          <span className="material-symbols-outlined text-sm text-on-surface-variant">terminal</span>
          <span className="font-label-md text-label-md font-bold text-on-surface-variant uppercase tracking-wide">Pipeline Log</span>
        </div>
        <div
          ref={eventListRef}
          className="h-64 overflow-y-auto custom-scrollbar p-md flex flex-col gap-xs font-mono text-xs"
        >
          {events.length === 0 ? (
            <span className="text-on-surface-variant italic">Connecting to pipeline...</span>
          ) : (
            events
              .filter(e => e.stage !== 'HEARTBEAT')
              .map((evt, i) => (
                <div key={i} className="flex items-start gap-sm">
                  <span className="text-on-surface-variant/50 shrink-0 tabular-nums">
                    {new Date(evt.timestamp).toLocaleTimeString()}
                  </span>
                  <span className={`shrink-0 font-bold w-24 ${STAGE_CONFIG[evt.stage]?.color ?? 'text-slate-500'}`}>
                    [{evt.stage}]
                  </span>
                  <span className="text-on-surface">{evt.message}</span>
                </div>
              ))
          )}
        </div>
      </div>

    </main>
  );
}
