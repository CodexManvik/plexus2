import { useState, useRef, DragEvent, ChangeEvent, FormEvent, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

type StepType = 'idle' | 'uploading' | 'parsing' | 'extracting' | 'grounding' | 'validating' | 'done';

const STEPS: { key: StepType; label: string; icon: string }[] = [
  { key: 'uploading',  label: 'Ingest',   icon: 'cloud_upload'  },
  { key: 'parsing',   label: 'Parse',    icon: 'sync_alt'      },
  { key: 'extracting',label: 'Extract',  icon: 'psychology'    },
  { key: 'grounding', label: 'Ground',   icon: 'tag'           },
  { key: 'validating',label: 'Validate', icon: 'fact_check'    },
  { key: 'done',      label: 'Complete', icon: 'check_circle'  },
];

const STEP_ORDER: StepType[] = ['uploading','parsing','extracting','grounding','validating','done'];

function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'pdf')  return 'picture_as_pdf';
  if (ext === 'docx') return 'description';
  if (ext === 'xlsx') return 'table_chart';
  return 'attach_file';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ── Processing Overlay ────────────────────────────────────────────────────────

interface ProcessingOverlayProps {
  step: StepType;
  message: string;
}

function ProcessingOverlay({ step, message }: ProcessingOverlayProps) {
  const currentStepIdx = STEP_ORDER.indexOf(step);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-md">
      <div className="relative w-full max-w-lg mx-4 bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-200/60">
        {/* Animated top accent */}
        <div className="h-1 w-full bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500 animate-pulse" />

        <div className="p-10 flex flex-col items-center gap-8">
          {/* Central spinner */}
          <div className="relative w-28 h-28">
            <div className="absolute inset-0 rounded-full border-[6px] border-slate-100" />
            <div className="absolute inset-0 rounded-full border-[6px] border-t-blue-600 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
            <div className="absolute inset-2 rounded-full bg-slate-50 flex items-center justify-center shadow-inner">
              <span
                className="material-symbols-outlined text-blue-600 text-4xl transition-all duration-500"
                style={{ fontVariationSettings: '"FILL" 1' }}
              >
                {step === 'done'
                  ? 'check_circle'
                  : STEPS.find((s) => s.key === step)?.icon || 'hourglass_empty'}
              </span>
            </div>
          </div>

          {/* Status text */}
          <div className="text-center space-y-2">
            <h2 className="text-base font-black text-slate-800 uppercase tracking-widest">
              {step === 'uploading' && 'Ingestion Active'}
              {step === 'parsing'   && 'Parsing Schema'}
              {step === 'extracting'&& 'AI Extraction'}
              {step === 'grounding' && 'Evidence Grounding'}
              {step === 'validating'&& 'Verifying Rules'}
              {step === 'done'      && 'Pipeline Complete'}
            </h2>
            <p className="text-sm text-slate-500 font-medium animate-pulse max-w-sm leading-relaxed">
              {message}
            </p>
          </div>

          {/* Step track */}
          <div className="w-full">
            <div className="flex items-center justify-between relative">
              {/* Connecting line */}
              <div className="absolute left-0 right-0 top-4 h-0.5 bg-slate-100 z-0" />
              <div
                className="absolute left-0 top-4 h-0.5 bg-blue-500 z-0 transition-all duration-700 ease-out"
                style={{ width: `${(currentStepIdx / (STEP_ORDER.length - 1)) * 100}%` }}
              />
              {STEPS.map((s, idx) => {
                const done = idx < currentStepIdx;
                const active = s.key === step;
                return (
                  <div key={s.key} className="flex flex-col items-center gap-1.5 z-10">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                        done
                          ? 'bg-blue-500 border-blue-500 text-white'
                          : active
                          ? 'bg-white border-blue-500 text-blue-600 shadow-md shadow-blue-100'
                          : 'bg-white border-slate-200 text-slate-300'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: done ? '"FILL" 1' : '"FILL" 0' }}>
                        {done ? 'check' : s.icon}
                      </span>
                    </div>
                    <span
                      className={`text-[9px] font-black uppercase tracking-wider ${
                        active ? 'text-blue-600' : done ? 'text-slate-400' : 'text-slate-300'
                      }`}
                    >
                      {s.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Upload() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form
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

  // UI
  const [isDragOver, setIsDragOver]     = useState(false);
  const [step, setStep]                 = useState<StepType>('idle');
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError]               = useState('');

  const validateAndSetFile = useCallback((f: File) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    if (!allowed.includes(f.type)) {
      setError('Unsupported file type. Accepted formats: PDF, DOCX, XLSX.');
      setFile(null);
      return;
    }
    setError('');
    setFile(f);
  }, []);

  const handleDragOver = (e: DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files[0]) validateAndSetFile(e.dataTransfer.files[0]);
  };
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) validateAndSetFile(e.target.files[0]);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) { setError('Select a contract file to begin.'); return; }

    setError('');
    setStep('uploading');
    setProgressMessage('Transmitting file to secure storage…');

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
      const { data: uploadData } = await api.post('/upload/', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const { contract_id } = uploadData;

      setStep('parsing');
      setProgressMessage('Structuring text blocks and resolving character encoding…');
      await delay(1200);

      setStep('extracting');
      setProgressMessage('Running Groq LLM across parameter batches…');
      const { data: extractData } = await api.post(`/extraction/${contract_id}/start`);

      setStep('grounding');
      setProgressMessage(`Pinning ${extractData.grounded ?? 0} citations to source coordinates…`);
      await delay(1200);

      setStep('validating');
      setProgressMessage('Applying validation rules and confidence thresholds…');
      await delay(900);

      setStep('done');
      setProgressMessage('Extraction complete — redirecting to review.');
      await delay(700);

      navigate(`/review/${contract_id}`);
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.detail || 'Pipeline failed. Check backend logs.');
      setStep('idle');
    }
  };

  const isProcessing = step !== 'idle';

  return (
    <>
      {/* Processing overlay */}
      {isProcessing && <ProcessingOverlay step={step} message={progressMessage} />}

      <main className="flex-1 flex flex-col min-h-[calc(100vh-3.5rem)] bg-[#f7f9fc] overflow-hidden">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept=".pdf,.docx,.xlsx"
          className="hidden"
        />

        {/* ── Page header ──────────────────────────────────────────────────── */}
        <div className="border-b border-slate-200 bg-white px-8 py-5 shrink-0">
          <div className="max-w-7xl mx-auto flex items-end justify-between">
            <div>
              <p className="text-[11px] font-black text-blue-600 uppercase tracking-widest mb-1">
                Contract Intelligence Platform
              </p>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                Upload &amp; Ingest Contract
              </h1>
              <p className="text-sm text-slate-500 mt-1 font-medium">
                Drop a legal document to trigger real-time AI extraction and grounding.
              </p>
            </div>
            <div className="flex items-center gap-2 mb-1">
              {['PDF', 'DOCX', 'XLSX'].map((fmt) => (
                <span
                  key={fmt}
                  className="px-2.5 py-1 bg-slate-100 border border-slate-200 text-slate-600 rounded-lg text-[10px] font-extrabold uppercase tracking-widest"
                >
                  {fmt}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto">
          <div className="max-w-7xl mx-auto px-8 py-8 flex flex-col gap-8">

            {/* Error banner */}
            {error && (
              <div className="flex items-center gap-3 bg-red-50 text-red-700 border border-red-200 px-5 py-3.5 rounded-2xl text-sm font-semibold shadow-sm">
                <span className="material-symbols-outlined text-[20px]">error</span>
                {error}
              </div>
            )}

            {/* ── Drop zone ─────────────────────────────────────────────── */}
            <div
              role="button"
              tabIndex={0}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
              className={`relative rounded-3xl border-2 border-dashed transition-all duration-300 cursor-pointer overflow-hidden select-none ${
                isDragOver
                  ? 'border-blue-500 bg-blue-50 scale-[1.005]'
                  : file
                  ? 'border-emerald-400 bg-emerald-50/40'
                  : 'border-slate-300 bg-white hover:border-blue-400 hover:bg-blue-50/20 hover:shadow-sm'
              }`}
            >
              {/* Dot grid background */}
              <div
                className="absolute inset-0 pointer-events-none opacity-50"
                style={{
                  backgroundImage: 'radial-gradient(circle, rgba(100,116,139,0.12) 1px, transparent 1px)',
                  backgroundSize: '20px 20px',
                }}
              />

              <div className="relative flex items-center justify-between px-10 py-10 gap-10">
                {/* Icon + text */}
                <div className="flex items-center gap-7">
                  <div
                    className={`w-20 h-20 rounded-2xl flex items-center justify-center shrink-0 shadow-inner transition-all duration-300 ${
                      file
                        ? 'bg-emerald-100'
                        : isDragOver
                        ? 'bg-blue-100'
                        : 'bg-slate-100'
                    }`}
                  >
                    <span
                      className={`material-symbols-outlined text-5xl transition-colors duration-300 ${
                        file ? 'text-emerald-600' : isDragOver ? 'text-blue-600' : 'text-slate-400'
                      }`}
                      style={{ fontVariationSettings: '"FILL" 1' }}
                    >
                      {file ? getFileIcon(file.name) : 'upload_file'}
                    </span>
                  </div>

                  <div>
                    {file ? (
                      <>
                        <p className="text-lg font-black text-slate-800 truncate max-w-md">
                          {file.name}
                        </p>
                        <p className="text-sm text-slate-500 font-semibold mt-0.5">
                          {formatBytes(file.size)} &middot; Ready for ingestion
                        </p>
                        <span className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-[11px] font-extrabold border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          File validated
                        </span>
                      </>
                    ) : (
                      <>
                        <p className="text-xl font-extrabold text-slate-700">
                          {isDragOver ? 'Release to upload' : 'Drop contract file here'}
                        </p>
                        <p className="text-sm text-slate-400 font-medium mt-1">
                          Or click to browse — PDF, DOCX, and XLSX are accepted
                        </p>
                      </>
                    )}
                  </div>
                </div>

                {/* Right: format badges */}
                {!file && (
                  <div className="shrink-0 hidden lg:flex flex-col gap-3">
                    {[
                      { ext: 'PDF',  icon: 'picture_as_pdf', color: 'text-red-500',   bg: 'bg-red-50 border-red-200'   },
                      { ext: 'DOCX', icon: 'description',    color: 'text-blue-500',  bg: 'bg-blue-50 border-blue-200'  },
                      { ext: 'XLSX', icon: 'table_chart',    color: 'text-green-600', bg: 'bg-green-50 border-green-200'},
                    ].map(({ ext, icon, color, bg }) => (
                      <div
                        key={ext}
                        className={`flex items-center gap-2.5 px-4 py-2 rounded-xl border ${bg} select-none`}
                      >
                        <span className={`material-symbols-outlined ${color} text-[18px]`} style={{ fontVariationSettings: '"FILL" 1' }}>
                          {icon}
                        </span>
                        <span className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wider">
                          {ext}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {file && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setFile(null); }}
                    className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-red-100 hover:text-red-600 text-slate-500 transition-colors border border-slate-200"
                    title="Remove file"
                  >
                    <span className="material-symbols-outlined text-[20px]">close</span>
                  </button>
                )}
              </div>
            </div>

            {/* ── Metadata form + info cards ───────────────────────────────── */}
            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Col 1–2: Form fields */}
                <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-8 py-5 border-b border-slate-100 flex items-center gap-3">
                    <span className="material-symbols-outlined text-blue-600 text-[20px]">edit_note</span>
                    <h2 className="text-sm font-black text-slate-800 uppercase tracking-wider">
                      Contract Metadata
                    </h2>
                  </div>

                  <div className="p-8 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">

                    {/* Organization */}
                    <div className="sm:col-span-2 space-y-1.5">
                      <label className="block text-[11px] font-black text-slate-500 uppercase tracking-wider">
                        Organization
                      </label>
                      <select
                        value={organization}
                        onChange={(e) => setOrganization(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-4 text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                      >
                        <option>LexIntel Corporate</option>
                        <option>Global Holdings LLC</option>
                        <option>Strategic Partners Inc.</option>
                      </select>
                    </div>

                    {/* Business Unit */}
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-black text-slate-500 uppercase tracking-wider">
                        Business Unit
                      </label>
                      <input
                        type="text"
                        value={businessUnit}
                        onChange={(e) => setBusinessUnit(e.target.value)}
                        placeholder="e.g. Finance"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-4 text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-slate-400 placeholder:font-normal"
                      />
                    </div>

                    {/* Location */}
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-black text-slate-500 uppercase tracking-wider">
                        Location
                      </label>
                      <input
                        type="text"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="New York, NY"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-4 text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-slate-400 placeholder:font-normal"
                      />
                    </div>

                    {/* Department */}
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-black text-slate-500 uppercase tracking-wider">
                        Department
                      </label>
                      <input
                        type="text"
                        value={department}
                        onChange={(e) => setDepartment(e.target.value)}
                        placeholder="Legal Operations"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-4 text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-slate-400 placeholder:font-normal"
                      />
                    </div>

                    {/* Customer / Partner */}
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-black text-slate-500 uppercase tracking-wider">
                        Customer / Partner <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="Apex Financial Group"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-4 text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-slate-400 placeholder:font-normal"
                      />
                    </div>

                    {/* Financial Year */}
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-black text-slate-500 uppercase tracking-wider">
                        Financial Year
                      </label>
                      <select
                        value={financialYear}
                        onChange={(e) => setFinancialYear(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-4 text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                      >
                        <option>FY 2025</option>
                        <option>FY 2024</option>
                        <option>FY 2023</option>
                      </select>
                    </div>

                    {/* Contract Type */}
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-black text-slate-500 uppercase tracking-wider">
                        Contract Type
                      </label>
                      <select
                        value={contractType}
                        onChange={(e) => setContractType(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-4 text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                      >
                        <option>Service Agreement</option>
                        <option>NDA</option>
                        <option>Technology</option>
                        <option>Procurement</option>
                        <option>Corporate</option>
                      </select>
                    </div>

                    {/* Agreement Type */}
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-black text-slate-500 uppercase tracking-wider">
                        Agreement Sub-type
                      </label>
                      <input
                        type="text"
                        value={agreementType}
                        onChange={(e) => setAgreementType(e.target.value)}
                        placeholder="Master Service Agreement (MSA)"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-4 text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-slate-400 placeholder:font-normal"
                      />
                    </div>

                    {/* Additional Notes */}
                    <div className="sm:col-span-2 space-y-1.5">
                      <label className="block text-[11px] font-black text-slate-500 uppercase tracking-wider">
                        Notes
                      </label>
                      <textarea
                        value={additionalInfo}
                        onChange={(e) => setAdditionalInfo(e.target.value)}
                        placeholder="Urgency flags, clause exceptions, internal reference numbers…"
                        rows={3}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-4 text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-slate-400 placeholder:font-normal resize-none"
                      />
                    </div>
                  </div>

                  {/* Submit */}
                  <div className="px-8 pb-8">
                    <button
                      type="submit"
                      disabled={!file}
                      className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-2xl font-black text-sm flex items-center justify-center gap-2.5 shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.99] disabled:opacity-40 disabled:pointer-events-none"
                    >
                      <span
                        className="material-symbols-outlined text-[20px]"
                        style={{ fontVariationSettings: '"FILL" 1' }}
                      >
                        auto_awesome
                      </span>
                      Start AI Ingestion Pipeline
                    </button>
                  </div>
                </div>

                {/* Col 3: Info cards */}
                <div className="flex flex-col gap-5">

                  {/* Pipeline card */}
                  <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-3xl p-6 text-white overflow-hidden relative shadow-xl shadow-blue-500/20">
                    <div className="absolute -right-6 -bottom-6 w-32 h-32 bg-white/5 rounded-full" />
                    <div className="absolute -right-2 -top-4 w-20 h-20 bg-white/5 rounded-full" />
                    <div className="relative z-10 space-y-3">
                      <div className="w-10 h-10 rounded-2xl bg-white/15 flex items-center justify-center">
                        <span className="material-symbols-outlined text-white text-[22px]" style={{ fontVariationSettings: '"FILL" 1' }}>
                          psychology
                        </span>
                      </div>
                      <h3 className="font-black text-base">AI Extraction Pipeline</h3>
                      <p className="text-sm text-white/75 leading-relaxed font-medium">
                        Extracts 50+ legal parameters across batches — dates, parties, indemnity, liability, termination clauses — and grounds each to source coordinates.
                      </p>
                    </div>
                  </div>

                  {/* Security card */}
                  <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center">
                        <span className="material-symbols-outlined text-emerald-600 text-[20px]" style={{ fontVariationSettings: '"FILL" 1' }}>
                          verified_user
                        </span>
                      </div>
                      <h3 className="font-black text-slate-800 text-sm">Secure Storage</h3>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed font-medium">
                      Documents are stored in encrypted Oracle Object Storage with role-based access controls. Access tokens are short-lived and non-shareable.
                    </p>
                    <div className="mt-4 flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-[10px] font-extrabold text-emerald-700 uppercase tracking-widest">
                        AES-256 Encrypted
                      </span>
                    </div>
                  </div>

                  {/* Stats card */}
                  <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
                    <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4">
                      Pipeline Metrics
                    </h3>
                    <div className="space-y-3">
                      {[
                        { label: 'Parameters extracted', value: '50+' },
                        { label: 'Supported formats',    value: 'PDF · DOCX · XLSX' },
                        { label: 'Avg. processing time', value: '~90s' },
                        { label: 'Grounding accuracy',   value: '~73%' },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex items-center justify-between">
                          <span className="text-xs text-slate-500 font-medium">{label}</span>
                          <span className="text-xs font-black text-slate-700">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      </main>
    </>
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
