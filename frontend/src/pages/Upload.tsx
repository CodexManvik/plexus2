import {
  useState, useRef, useEffect,
  DragEvent, ChangeEvent, FormEvent, useCallback
} from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface QueueJob {
  contract_id:    string;
  filename:       string;
  workflow_state: string;
  customer_name:  string | null;
  contract_type:  string | null;
  uploaded_at:    string | null;
  page_count:     number | null;
  blocks_count:   number | null;
}

interface QueueSummary {
  total:      number;
  processing: number;
  done:       number;
  failed:     number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const QUEUE_POLL_INTERVAL = 3500; // ms

const STATE_META: Record<string, { label: string; color: string; icon: string; ring: string }> = {
  UPLOADED:              { label: 'Uploaded',   color: 'text-slate-500',  icon: 'cloud_done',     ring: 'ring-slate-300'  },
  PARSING:               { label: 'Parsing',    color: 'text-blue-500',   icon: 'sync_alt',       ring: 'ring-blue-400'   },
  TAG_SUGGESTION_READY:  { label: 'Tagged',     color: 'text-indigo-500', icon: 'sell',           ring: 'ring-indigo-300' },
  EXTRACTION_RUNNING:    { label: 'Extracting', color: 'text-violet-600', icon: 'psychology',     ring: 'ring-violet-400' },
  GROUNDING_RUNNING:     { label: 'Grounding',  color: 'text-amber-500',  icon: 'tag',            ring: 'ring-amber-400'  },
  VALIDATION_RUNNING:    { label: 'Validating', color: 'text-orange-500', icon: 'fact_check',     ring: 'ring-orange-400' },
  DRAFT_READY:           { label: 'Complete',   color: 'text-emerald-600',icon: 'check_circle',   ring: 'ring-emerald-400'},
  EXTRACTION_FAILED:     { label: 'Failed',     color: 'text-red-500',    icon: 'error',          ring: 'ring-red-400'    },
};

const ACTIVE_STATES = new Set([
  'UPLOADED', 'PARSING', 'TAG_SUGGESTION_READY',
  'EXTRACTION_RUNNING', 'GROUNDING_RUNNING', 'VALIDATION_RUNNING',
]);

function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'pdf')  return 'picture_as_pdf';
  if (ext === 'docx') return 'description';
  if (ext === 'xlsx') return 'table_chart';
  return 'attach_file';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s  = Math.floor(ms / 1000);
  if (s < 60)   return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

// ── Queue Job Card ─────────────────────────────────────────────────────────────

function JobCard({ job, onReview }: { job: QueueJob; onReview: (id: string) => void }) {
  const meta   = STATE_META[job.workflow_state] ?? STATE_META.UPLOADED;
  const active = ACTIVE_STATES.has(job.workflow_state);
  const done   = job.workflow_state === 'DRAFT_READY';
  const failed = job.workflow_state === 'EXTRACTION_FAILED';

  return (
    <div
      className={`group relative flex items-start gap-4 p-4 rounded-2xl border transition-all duration-300 ${
        done
          ? 'bg-emerald-50/60 border-emerald-200'
          : failed
          ? 'bg-red-50/60 border-red-200'
          : active
          ? 'bg-white border-slate-200 shadow-sm'
          : 'bg-slate-50 border-slate-200'
      }`}
    >
      {/* File-type icon with status ring */}
      <div
        className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ring-2 ${meta.ring} ${
          done ? 'bg-emerald-100' : failed ? 'bg-red-100' : 'bg-white'
        }`}
      >
        <span
          className={`material-symbols-outlined text-[20px] ${meta.color} ${active ? 'animate-pulse' : ''}`}
          style={{ fontVariationSettings: done || failed ? '"FILL" 1' : '"FILL" 0' }}
        >
          {getFileIcon(job.filename)}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold text-slate-800 truncate">{job.filename}</p>
          <span
            className={`shrink-0 flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
              done    ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
              failed  ? 'bg-red-100 text-red-700 border-red-200'            :
              active  ? 'bg-violet-100 text-violet-700 border-violet-200'   :
                        'bg-slate-100 text-slate-600 border-slate-200'
            }`}
          >
            <span
              className={`material-symbols-outlined text-[12px] ${active ? 'animate-spin' : ''}`}
              style={{ fontVariationSettings: '"FILL" 1' }}
            >
              {meta.icon}
            </span>
            {meta.label}
          </span>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500 font-medium">
          {job.customer_name && <span>{job.customer_name}</span>}
          {job.contract_type && <span className="text-slate-400">·</span>}
          {job.contract_type && <span>{job.contract_type}</span>}
          {job.uploaded_at   && <span className="text-slate-400">·</span>}
          {job.uploaded_at   && <span>{timeAgo(job.uploaded_at)}</span>}
        </div>

        {/* Progress detail */}
        <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-500">
          {job.blocks_count != null && (
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px]">segment</span>
              {job.blocks_count} blocks
            </span>
          )}
          {job.page_count != null && (
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px]">article</span>
              {job.page_count} pages
            </span>
          )}
        </div>

        {/* Indeterminate progress bar for active jobs */}
        {active && (
          <div className="mt-2.5 h-1 w-full bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full w-1/3 bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full animate-[slide_1.8s_ease-in-out_infinite]" />
          </div>
        )}
      </div>

      {/* Review button — only for completed jobs */}
      {done && (
        <button
          onClick={() => onReview(job.contract_id)}
          className="shrink-0 self-center px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-black rounded-xl transition-colors shadow-sm"
        >
          Review
        </button>
      )}
    </div>
  );
}

// ── Main Upload Page ───────────────────────────────────────────────────────────

export default function Upload() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [file, setFile]                     = useState<File | null>(null);
  const [organization, setOrganization]     = useState('LexIntel Corporate');
  const [businessUnit, setBusinessUnit]     = useState('');
  const [location, setLocation]             = useState('');
  const [department, setDepartment]         = useState('');
  const [customerName, setCustomerName]     = useState('');
  const [financialYear, setFinancialYear]   = useState('FY 2025');
  const [contractType, setContractType]     = useState('Service Agreement');
  const [agreementType, setAgreementType]   = useState('');
  const [additionalInfo, setAdditionalInfo] = useState('');

  // UI state
  const [isDragOver, setIsDragOver]   = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Queue state
  const [jobs, setJobs]         = useState<QueueJob[]>([]);
  const [summary, setSummary]   = useState<QueueSummary>({ total: 0, processing: 0, done: 0, failed: 0 });
  const [queueError, setQueueError] = useState('');

  // ── Queue polling ────────────────────────────────────────────────────────────
  const fetchQueue = useCallback(async () => {
    try {
      const { data } = await api.get('/queue/jobs');
      setJobs(data.jobs ?? []);
      setSummary(data.summary ?? { total: 0, processing: 0, done: 0, failed: 0 });
      setQueueError('');
    } catch (err: any) {
      setQueueError(err.response?.data?.detail ?? 'Failed to load queue.');
    }
  }, []);

  useEffect(() => {
    fetchQueue();
    const id = setInterval(fetchQueue, QUEUE_POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchQueue]);

  // ── File handling ────────────────────────────────────────────────────────────
  const validateAndSetFile = useCallback((f: File) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    if (!allowed.includes(f.type)) {
      setSubmitError('Unsupported file type. Accepted: PDF, DOCX, XLSX.');
      setFile(null);
      return;
    }
    setSubmitError('');
    setFile(f);
  }, []);

  const handleDragOver  = (e: DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e: DragEvent) => {
    e.preventDefault(); setIsDragOver(false);
    if (e.dataTransfer.files[0]) validateAndSetFile(e.dataTransfer.files[0]);
  };
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) validateAndSetFile(e.target.files[0]);
  };

  // ── Submit ───────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) { setSubmitError('Select a contract file to begin.'); return; }

    setSubmitError('');
    setSubmitting(true);

    const fd = new FormData();
    fd.append('file', file);
    fd.append('organization', organization);
    fd.append('business_unit', businessUnit);
    fd.append('location', location);
    fd.append('department', department);
    fd.append('customer_name', customerName || file.name.split('.')[0]);
    fd.append('financial_year', financialYear);
    fd.append('contract_type', contractType);
    fd.append('agreement_type', agreementType);
    fd.append('additional_info', additionalInfo);

    try {
      await api.post('/upload/', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      // Reset form — job appears in queue immediately via next poll
      setFile(null);
      setCustomerName('');
      setAdditionalInfo('');
      setAgreementType('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      // Trigger an immediate queue refresh
      await fetchQueue();
    } catch (err: any) {
      setSubmitError(err.response?.data?.detail ?? 'Upload failed. Check backend logs.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <main className="flex-1 flex overflow-hidden min-h-[calc(100vh-3.5rem)] bg-[#f7f9fc]">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".pdf,.docx,.xlsx"
        className="hidden"
      />

      {/* ── Left: Upload Form ────────────────────────────────────────────────── */}
      <div className="flex flex-col w-[520px] shrink-0 border-r border-slate-200 bg-white overflow-y-auto">

        {/* Header */}
        <div className="px-8 pt-8 pb-5 border-b border-slate-100">
          <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-1">
            Contract Intelligence Platform
          </p>
          <h1 className="text-xl font-black text-slate-900 tracking-tight">Upload Contract</h1>
          <p className="text-xs text-slate-500 mt-1 font-medium">
            Paste and submit — extraction runs in the background.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1">
          <div className="px-8 py-6 flex flex-col gap-5 flex-1">

            {/* Error banner */}
            {submitError && (
              <div className="flex items-center gap-2 bg-red-50 text-red-700 border border-red-200 px-4 py-3 rounded-xl text-xs font-semibold">
                <span className="material-symbols-outlined text-[16px]">error</span>
                {submitError}
              </div>
            )}

            {/* Drop zone */}
            <div
              role="button"
              tabIndex={0}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
              className={`relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed py-8 px-6 cursor-pointer transition-all duration-200 select-none ${
                isDragOver
                  ? 'border-blue-500 bg-blue-50'
                  : file
                  ? 'border-emerald-400 bg-emerald-50/40'
                  : 'border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/20'
              }`}
            >
              <div
                className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-3 ${
                  file ? 'bg-emerald-100' : isDragOver ? 'bg-blue-100' : 'bg-slate-200'
                }`}
              >
                <span
                  className={`material-symbols-outlined text-4xl ${
                    file ? 'text-emerald-600' : isDragOver ? 'text-blue-600' : 'text-slate-400'
                  }`}
                  style={{ fontVariationSettings: '"FILL" 1' }}
                >
                  {file ? getFileIcon(file.name) : 'upload_file'}
                </span>
              </div>

              {file ? (
                <div className="text-center">
                  <p className="text-sm font-black text-slate-800 truncate max-w-xs">{file.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{formatBytes(file.size)} · Ready</p>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setFile(null); }}
                    className="mt-2 text-[11px] font-bold text-slate-400 hover:text-red-500 underline transition-colors"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="text-center">
                  <p className="text-sm font-bold text-slate-600">
                    {isDragOver ? 'Release to upload' : 'Drop or click to browse'}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">PDF · DOCX · XLSX</p>
                </div>
              )}
            </div>

            {/* ── Metadata Fields ────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-4">

              {/* Organization — full width */}
              <div className="col-span-2 space-y-1">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Organization</label>
                <select
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                >
                  <option>LexIntel Corporate</option>
                  <option>Global Holdings LLC</option>
                  <option>Strategic Partners Inc.</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Business Unit</label>
                <input type="text" value={businessUnit} onChange={(e) => setBusinessUnit(e.target.value)}
                  placeholder="Finance"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-slate-400 placeholder:font-normal" />
              </div>

              <div className="space-y-1">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Location</label>
                <input type="text" value={location} onChange={(e) => setLocation(e.target.value)}
                  placeholder="New York, NY"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-slate-400 placeholder:font-normal" />
              </div>

              <div className="space-y-1">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Department</label>
                <input type="text" value={department} onChange={(e) => setDepartment(e.target.value)}
                  placeholder="Legal Operations"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-slate-400 placeholder:font-normal" />
              </div>

              <div className="space-y-1">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Financial Year</label>
                <select value={financialYear} onChange={(e) => setFinancialYear(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all">
                  <option>FY 2025</option><option>FY 2024</option><option>FY 2023</option>
                </select>
              </div>

              <div className="col-span-2 space-y-1">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">
                  Customer / Partner <span className="text-red-500">*</span>
                </label>
                <input type="text" required value={customerName} onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Apex Financial Group"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-slate-400 placeholder:font-normal" />
              </div>

              <div className="space-y-1">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Contract Type</label>
                <select value={contractType} onChange={(e) => setContractType(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all">
                  <option>Service Agreement</option><option>NDA</option>
                  <option>Technology</option><option>Procurement</option><option>Corporate</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Sub-type</label>
                <input type="text" value={agreementType} onChange={(e) => setAgreementType(e.target.value)}
                  placeholder="MSA"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-slate-400 placeholder:font-normal" />
              </div>

              <div className="col-span-2 space-y-1">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Notes</label>
                <textarea value={additionalInfo} onChange={(e) => setAdditionalInfo(e.target.value)}
                  placeholder="Urgency flags, clause exceptions, internal ref numbers…"
                  rows={2}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-slate-400 placeholder:font-normal resize-none" />
              </div>
            </div>
          </div>

          {/* Submit */}
          <div className="px-8 pb-8 pt-2 mt-auto">
            <button
              type="submit"
              disabled={!file || submitting}
              className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-2xl font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.99] disabled:opacity-40 disabled:pointer-events-none"
            >
              {submitting ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Uploading &amp; Parsing…
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: '"FILL" 1' }}>
                    auto_awesome
                  </span>
                  Submit — Extraction Runs in Background
                </>
              )}
            </button>
            <p className="text-center text-[10px] text-slate-400 mt-2 font-medium">
              The form resets immediately. Monitor progress in the queue →
            </p>
          </div>
        </form>
      </div>

      {/* ── Right: Live Processing Queue ─────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#f7f9fc]">

        {/* Queue header */}
        <div className="px-8 py-6 border-b border-slate-200 bg-white shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-black text-slate-800">Processing Queue</h2>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Refreshes every {QUEUE_POLL_INTERVAL / 1000}s · Last 24 hours
              </p>
            </div>
            {/* Summary badges */}
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-100 text-violet-700 rounded-xl text-[11px] font-extrabold border border-violet-200">
                <span className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
                {summary.processing} Processing
              </span>
              <span className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-xl text-[11px] font-extrabold border border-emerald-200">
                <span className="material-symbols-outlined text-[13px]" style={{ fontVariationSettings: '"FILL" 1' }}>check_circle</span>
                {summary.done} Done
              </span>
              {summary.failed > 0 && (
                <span className="flex items-center gap-1.5 px-3 py-1.5 bg-red-100 text-red-700 rounded-xl text-[11px] font-extrabold border border-red-200">
                  <span className="material-symbols-outlined text-[13px]" style={{ fontVariationSettings: '"FILL" 1' }}>error</span>
                  {summary.failed} Failed
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Job list */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-3 custom-scrollbar">
          {queueError && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 border border-red-200 px-4 py-3 rounded-xl text-xs font-semibold">
              <span className="material-symbols-outlined text-[16px]">error</span>
              {queueError}
            </div>
          )}

          {jobs.length === 0 && !queueError && (
            <div className="flex flex-col items-center justify-center py-24 text-slate-400 select-none">
              <span className="material-symbols-outlined text-6xl mb-3 opacity-30">inbox</span>
              <p className="text-sm font-bold">No jobs in the last 24 hours</p>
              <p className="text-xs mt-1">Upload a contract to get started.</p>
            </div>
          )}

          {jobs.map((job) => (
            <JobCard
              key={job.contract_id}
              job={job}
              onReview={(id) => navigate(`/review/${id}`)}
            />
          ))}
        </div>

        {/* Footer stats */}
        {jobs.length > 0 && (
          <div className="px-6 py-3 border-t border-slate-200 bg-white shrink-0 flex items-center justify-between text-[11px] text-slate-500 font-medium">
            <span>{summary.total} job{summary.total !== 1 ? 's' : ''} shown</span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </span>
          </div>
        )}
      </div>

      {/* Slide animation for the progress bar */}
      <style>{`
        @keyframes slide {
          0%   { transform: translateX(-100%); }
          60%  { transform: translateX(300%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </main>
  );
}
