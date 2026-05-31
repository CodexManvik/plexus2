import { useState, useRef, DragEvent, ChangeEvent, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

type StepType = 'idle' | 'uploading' | 'parsing' | 'extracting' | 'grounding' | 'validating' | 'done';

export default function Upload() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form states
  const [file, setFile] = useState<File | null>(null);
  const [organization, setOrganization] = useState('LexIntel Corporate');
  const [businessUnit, setBusinessUnit] = useState('Finance');
  const [location, setLocation] = useState('New York, NY');
  const [department, setDepartment] = useState('Legal Operations');
  const [customerName, setCustomerName] = useState('');
  const [financialYear, setFinancialYear] = useState('FY 2024');
  const [contractType, setContractType] = useState('Service Agreement');
  const [agreementType, setAgreementType] = useState('Master Service Agreement (MSA)');
  const [additionalInfo, setAdditionalInfo] = useState('');

  // UI state
  const [isDragOver, setIsDragOver] = useState(false);
  const [step, setStep] = useState<StepType>('idle');
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError] = useState('');

  // Drag and drop handlers
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    setError('');
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      validateAndSetFile(droppedFile);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    setError('');
    if (e.target.files && e.target.files.length > 0) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const validateAndSetFile = (selectedFile: File) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (!allowedTypes.includes(selectedFile.type)) {
      setError('Unsupported file type. Only PDF and DOCX documents are supported.');
      setFile(null);
      return;
    }
    
    setFile(selectedFile);
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  // Submit and orchestrate background AI pipeline
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Please select or drop a contract file to initiate analysis.');
      return;
    }

    setError('');
    setStep('uploading');
    setProgressMessage('Transmitting file to OCI Object Storage...');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('organization', organization);
    formData.append('business_unit', businessUnit);
    formData.append('location', location);
    formData.append('department', department);
    formData.append('customer_name', customerName || file.name.split('.')[0]);
    formData.append('financial_year', financialYear);
    formData.append('contract_type', contractType);
    formData.append('agreement_type', agreementType);
    formData.append('additional_info', additionalInfo);

    try {
      // Step 1: Upload and Parse text blocks
      const uploadResponse = await api.post('/upload/', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      const { contract_id } = uploadResponse.data;

      setStep('parsing');
      setProgressMessage('Structuring text chunks and verifying OCR characters...');
      await new Promise(resolve => setTimeout(resolve, 1500)); // Visual spacing

      // Step 2: Trigger the Groq-AI pipeline
      setStep('extracting');
      setProgressMessage('Processing through Groq LLM (parameter batch extraction)...');
      
      const extractionResponse = await api.post(`/extraction/${contract_id}/start`);
      
      // Step 3: Evidences & grounding
      setStep('grounding');
      setProgressMessage(`Grounded ${extractionResponse.data.grounded} parameter citations...`);
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Step 4: Validations
      setStep('validating');
      setProgressMessage('Running validation rules on coordinates...');
      await new Promise(resolve => setTimeout(resolve, 1000));

      setStep('done');
      setProgressMessage('Extraction pipeline complete!');
      await new Promise(resolve => setTimeout(resolve, 800));

      // Navigate to Review page
      navigate(`/review/${contract_id}`);

    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.detail || 'Extraction pipeline failed. Please check Groq quota and verify connection.');
      setStep('idle');
    }
  };

  if (step !== 'idle') {
    return (
      <div className="flex-grow flex flex-col items-center justify-center p-xl min-h-[calc(100vh-3.5rem)] bg-surface/30 select-none">
        <div className="max-w-md w-full bg-white p-xl rounded-2xl border border-outline-variant/30 shadow-xl text-center flex flex-col items-center gap-md relative overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-blue-500 to-indigo-600"></div>
          
          {/* Animated Spinner with Step Info */}
          <div className="relative w-24 h-24 flex items-center justify-center mt-sm">
            <div className="absolute inset-0 border-4 border-slate-100 rounded-full shadow-inner"></div>
            <div className="absolute inset-0 border-4 border-primary rounded-full animate-spin border-t-transparent shadow-md"></div>
            <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center shadow-inner">
              <span className="material-symbols-outlined text-primary text-[28px] font-bold">
                {step === 'uploading' && 'cloud_upload'}
                {step === 'parsing' && 'sync_alt'}
                {step === 'extracting' && 'psychology'}
                {step === 'grounding' && 'tag'}
                {step === 'validating' && 'fact_check'}
                {step === 'done' && 'check_circle'}
              </span>
            </div>
          </div>

          <div className="space-y-xs my-sm">
            <h2 className="text-[13px] font-black text-primary uppercase tracking-wider">
              {step === 'uploading' && 'Ingestion Active'}
              {step === 'parsing' && 'Parsing Schema'}
              {step === 'extracting' && 'AI Extraction'}
              {step === 'grounding' && 'Evidence Grounding'}
              {step === 'validating' && 'Verifying Rules'}
              {step === 'done' && 'Complete'}
            </h2>
            <p className="font-body-md text-body-md text-slate-500 font-semibold animate-pulse px-4 leading-relaxed">
              {progressMessage}
            </p>
          </div>

          {/* Stepper Progress Badges */}
          <div className="flex justify-between items-center w-full border-t border-slate-100 pt-lg mt-sm text-[10px] font-extrabold text-slate-400">
            <span className={step === 'uploading' ? 'text-primary' : ''}>INGEST</span>
            <span className="material-symbols-outlined text-[12px] font-bold">chevron_right</span>
            <span className={step === 'parsing' ? 'text-primary' : ''}>PARSE</span>
            <span className="material-symbols-outlined text-[12px] font-bold">chevron_right</span>
            <span className={step === 'extracting' ? 'text-primary' : ''}>EXTRACT</span>
            <span className="material-symbols-outlined text-[12px] font-bold">chevron_right</span>
            <span className={step === 'grounding' || step === 'validating' ? 'text-primary' : ''}>GROUND</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <main className="flex-1 flex overflow-hidden min-h-[calc(100vh-3.5rem)] bg-surface/30">
      {/* Hidden file input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange}
        accept=".pdf,.docx"
        className="hidden" 
      />

      {/* Left Pane: Drag & Drop Dropzone */}
      <section className="flex-1 p-lg flex flex-col gap-lg overflow-y-auto custom-scrollbar select-none">
        <div className="flex justify-between items-end border-b border-slate-100 pb-sm">
          <div>
            <h1 className="font-display-sm text-display-sm text-primary font-black tracking-tight">Upload Contract</h1>
            <p className="font-body-md text-body-md text-on-surface-variant font-medium">
              Drag and drop corporate agreements to trigger real-time metadata parsing and AI grounding.
            </p>
          </div>
          <div className="flex gap-xs">
            <span className="px-sm py-[2px] bg-slate-100 border border-slate-200 text-slate-600 rounded-full text-[10px] font-extrabold uppercase tracking-wider">PDF</span>
            <span className="px-sm py-[2px] bg-slate-100 border border-slate-200 text-slate-600 rounded-full text-[10px] font-extrabold uppercase tracking-wider">DOCX</span>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 border border-red-200 px-lg py-md rounded-xl text-sm font-semibold shadow-sm">
            {error}
          </div>
        )}

        {/* Bento Dropzone Container */}
        <div className="grid grid-cols-12 gap-md flex-1 min-h-[360px]">
          <div 
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={triggerFileSelect}
            className={`col-span-12 md:col-span-8 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center p-xl group transition-all duration-350 cursor-pointer relative overflow-hidden shadow-sm ${
              isDragOver 
                ? 'border-primary bg-blue-50/30' 
                : 'border-outline-variant/60 bg-white hover:border-primary hover:shadow-md'
            }`}
          >
            {/* Background Visual Subtle Grid */}
            <div className="absolute inset-0 opacity-[0.02] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#041627 1.5px, transparent 1.5px)', backgroundSize: '16px 16px' }}></div>
            
            <div className="w-16 h-16 bg-primary-fixed text-primary rounded-2xl flex items-center justify-center mb-md group-hover:scale-105 transition-transform duration-300 shadow-inner shrink-0">
              <span className="material-symbols-outlined text-[28px] font-bold">upload_file</span>
            </div>

            {file ? (
              <div className="text-center space-y-xs z-10 max-w-sm px-md">
                <p className="font-body-lg text-body-lg font-black text-primary truncate" title={file.name}>{file.name}</p>
                <p className="text-[12px] text-slate-500 font-semibold">
                  {(file.size / 1024 / 1024).toFixed(2)} MB • Document verified successfully
                </p>
                <span className="mt-md inline-block bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 font-bold text-label-md px-lg py-1.5 rounded-xl transition-colors shadow-sm select-none">
                  CHANGE SELECTED FILE
                </span>
              </div>
            ) : (
              <div className="text-center z-10 px-md">
                <p className="font-headline-md text-headline-md text-primary font-extrabold mb-xs">Drop contract file here to parse</p>
                <p className="font-body-sm text-[12px] text-slate-500 max-w-xs mx-auto font-medium leading-relaxed">
                  Click to browse local files or drop standard corporate PDFs and DOCX files.
                </p>
                <div className="mt-lg flex gap-md justify-center select-none">
                  <div className="flex flex-col items-center gap-[2px] px-lg py-sm bg-slate-50 border border-slate-100 rounded-xl shadow-sm shrink-0">
                    <span className="material-symbols-outlined text-primary text-[20px] font-bold">picture_as_pdf</span>
                    <span className="text-[10px] font-extrabold text-slate-600">Legal PDF</span>
                  </div>
                  <div className="flex flex-col items-center gap-[2px] px-lg py-sm bg-slate-50 border border-slate-100 rounded-xl shadow-sm shrink-0">
                    <span className="material-symbols-outlined text-primary text-[20px] font-bold">description</span>
                    <span className="text-[10px] font-extrabold text-slate-600">Word Doc</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Secondary Info Cards (Bento Style) */}
          <div className="col-span-12 md:col-span-4 flex flex-col gap-md">
            <div className="flex-1 bg-gradient-to-br from-slate-50 to-indigo-50/50 border border-slate-200/50 text-slate-800 p-lg rounded-2xl flex flex-col justify-between overflow-hidden relative shadow-sm">
              <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-100/30 rounded-full blur-xl -mr-6 -mt-6"></div>
              
              <div className="z-10">
                <h3 className="text-[14px] font-black mb-xs uppercase tracking-wider text-indigo-700">AI Ingest System</h3>
                <p className="text-[12px] text-slate-500 font-bold leading-relaxed">
                  Our pipeline automatically extracts over 50 distinct legal clauses, indemnity scopes, and key date thresholds.
                </p>
              </div>
              <div className="absolute bottom-0 right-0 translate-x-1/4 translate-y-1/4 select-none pointer-events-none">
                <span className="material-symbols-outlined text-indigo-600/10 opacity-30 text-[110px]" style={{ fontVariationSettings: '"FILL" 1' }}>psychology</span>
              </div>
            </div>
            
            <div className="flex-1 bg-white border border-outline-variant/30 p-lg rounded-2xl flex flex-col justify-between shadow-sm">
              <div>
                <h3 className="font-headline-md text-headline-md text-primary font-extrabold mb-xs">Secure Oracle Storage</h3>
                <p className="text-[12px] text-slate-500 font-medium leading-relaxed">
                  Documents are stored in a private, encrypted storage container with local role-based access tokens.
                </p>
              </div>
              <div className="flex items-center gap-sm mt-md bg-slate-50 border border-slate-100 p-sm rounded-xl select-none">
                <span className="material-symbols-outlined text-emerald-600 text-[20px] font-bold">verified_user</span>
                <span className="text-[9px] text-slate-500 uppercase tracking-wider font-black">AES-256 Encrypted</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Right Pane: Metadata Tagging Side Panel */}
      <aside className="w-[440px] bg-white border-l border-outline-variant/40 flex flex-col shadow-sm select-none">
        <div className="p-lg border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h2 className="font-headline-md text-headline-md text-primary font-black tracking-tight">Tagging &amp; Metadata</h2>
          <span className="material-symbols-outlined text-on-surface-variant cursor-pointer">more_vert</span>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-lg space-y-lg custom-scrollbar">
            
            {/* Entity Details */}
            <div className="space-y-md">
              <p className="text-[10px] text-slate-400 font-black uppercase tracking-wider">Entity Details</p>
              
              <div className="space-y-xs">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Organization</label>
                <select 
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl py-2 px-3 font-semibold text-slate-700 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                >
                  <option>LexIntel Corporate</option>
                  <option>Global Holdings LLC</option>
                  <option>Strategic Partners Inc.</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-md">
                <div className="space-y-xs">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Business Unit</label>
                  <input 
                    type="text"
                    value={businessUnit}
                    onChange={(e) => setBusinessUnit(e.target.value)}
                    placeholder="e.g. Finance" 
                    className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl py-2 px-3 font-semibold text-slate-700 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-slate-400 placeholder:font-normal"
                  />
                </div>
                <div className="space-y-xs">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Location</label>
                  <input 
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="New York, NY" 
                    className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl py-2 px-3 font-semibold text-slate-700 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-slate-400 placeholder:font-normal"
                  />
                </div>
              </div>

              <div className="space-y-xs">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Department</label>
                <input 
                  type="text"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  placeholder="Legal Operations" 
                  className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl py-2 px-3 font-semibold text-slate-700 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-slate-400 placeholder:font-normal"
                />
              </div>
            </div>

            <hr className="border-slate-100" />

            {/* Contract Context */}
            <div className="space-y-md">
              <p className="text-[10px] text-slate-400 font-black uppercase tracking-wider">Contractual Context</p>
              
              <div className="space-y-xs">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Customer/Partner Name (Client)</label>
                <input 
                  type="text"
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="e.g. Apex Financial Group" 
                  className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl py-2 px-3 font-semibold text-slate-700 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-slate-400 placeholder:font-normal"
                />
              </div>

              <div className="grid grid-cols-2 gap-md">
                <div className="space-y-xs">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Financial Year</label>
                  <select 
                    value={financialYear}
                    onChange={(e) => setFinancialYear(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl py-2 px-3 font-semibold text-slate-700 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                  >
                    <option>FY 2024</option>
                    <option>FY 2023</option>
                    <option>FY 2025</option>
                  </select>
                </div>
                <div className="space-y-xs">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Contract Type</label>
                  <select 
                    value={contractType}
                    onChange={(e) => setContractType(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl py-2 px-3 font-semibold text-slate-700 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                  >
                    <option>Service Agreement</option>
                    <option>NDA</option>
                    <option>Technology</option>
                    <option>Procurement</option>
                    <option>Corporate</option>
                  </select>
                </div>
              </div>

              <div className="space-y-xs">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Agreement Type</label>
                <input 
                  type="text"
                  value={agreementType}
                  onChange={(e) => setAgreementType(e.target.value)}
                  placeholder="Master Service Agreement (MSA)" 
                  className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl py-2 px-3 font-semibold text-slate-700 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-slate-400 placeholder:font-normal"
                />
              </div>

              <div className="space-y-xs">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Additional Info (Notes)</label>
                <textarea 
                  value={additionalInfo}
                  onChange={(e) => setAdditionalInfo(e.target.value)}
                  placeholder="Notes on urgency, specific clause exceptions, or internal references..." 
                  rows={3}
                  className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl py-2 px-3 font-semibold text-slate-700 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-slate-400 placeholder:font-normal resize-none"
                ></textarea>
              </div>
            </div>
          </div>

          {/* Sticky Footer Action */}
          <div className="p-lg bg-white border-t border-slate-100 mt-auto">
            <button 
              type="submit"
              className="w-full py-3 bg-primary hover:bg-primary/95 text-on-primary rounded-xl font-bold text-[14px] flex items-center justify-center gap-xs hover:scale-[1.01] active:scale-[0.99] transition-all shadow-md select-none"
            >
              <span className="material-symbols-outlined text-[20px] font-bold">auto_awesome</span>
              Submit &amp; Start Ingestion
            </button>
          </div>
        </form>
      </aside>
    </main>
  );
}
