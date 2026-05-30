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
      <div className="flex-1 flex flex-col items-center justify-center p-xl min-h-[calc(100vh-3.5rem)] bg-surface-container-low">
        <div className="max-w-md w-full bg-white p-xl rounded-xl border border-outline-variant shadow-lg text-center flex flex-col items-center gap-md">
          {/* Animated Spinner with Step Info */}
          <div className="relative w-24 h-24 flex items-center justify-center">
            <div className="absolute inset-0 border-4 border-primary-fixed rounded-full"></div>
            <div className="absolute inset-0 border-4 border-primary rounded-full animate-spin border-t-transparent"></div>
            <span className="material-symbols-outlined text-primary text-3xl">
              {step === 'uploading' && 'cloud_upload'}
              {step === 'parsing' && 'sync_alt'}
              {step === 'extracting' && 'psychology'}
              {step === 'grounding' && 'tag'}
              {step === 'validating' && 'fact_check'}
              {step === 'done' && 'check_circle'}
            </span>
          </div>

          <div className="space-y-sm">
            <h2 className="font-headline-md text-headline-md text-primary uppercase tracking-wider">
              {step === 'uploading' && 'Ingestion Active'}
              {step === 'parsing' && 'Parsing Schema'}
              {step === 'extracting' && 'AI Extraction'}
              {step === 'grounding' && 'Evidence Grounding'}
              {step === 'validating' && 'Verifying Rules'}
              {step === 'done' && 'Complete'}
            </h2>
            <p className="font-body-md text-body-md text-on-surface-variant animate-pulse px-4">
              {progressMessage}
            </p>
          </div>

          {/* Stepper Progress Badges */}
          <div className="flex justify-between w-full border-t border-outline-variant pt-lg mt-md text-[10px] font-bold text-on-surface-variant">
            <span className={step === 'uploading' ? 'text-primary' : ''}>Ingest</span>
            <span className="material-symbols-outlined text-[10px]">chevron_right</span>
            <span className={step === 'parsing' ? 'text-primary' : ''}>Parse</span>
            <span className="material-symbols-outlined text-[10px]">chevron_right</span>
            <span className={step === 'extracting' ? 'text-primary' : ''}>Extract</span>
            <span className="material-symbols-outlined text-[10px]">chevron_right</span>
            <span className={step === 'grounding' || step === 'validating' ? 'text-primary' : ''}>Ground</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <main className="flex-1 flex overflow-hidden min-h-[calc(100vh-3.5rem)]">
      {/* Hidden file input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange}
        accept=".pdf,.docx"
        className="hidden" 
      />

      {/* Left Pane: Drag & Drop Dropzone */}
      <section className="flex-1 p-lg flex flex-col gap-lg overflow-y-auto custom-scrollbar bg-background">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="font-display-sm text-display-sm text-primary">Upload Contract</h1>
            <p className="font-body-md text-body-md text-on-surface-variant">
              Drag and drop documents to initiate AI-powered metadata extraction.
            </p>
          </div>
          <div className="flex gap-sm">
            <span className="px-sm py-1 bg-surface-container-high text-on-surface-variant rounded-full text-label-md font-label-md">PDF</span>
            <span className="px-sm py-1 bg-surface-container-high text-on-surface-variant rounded-full text-label-md font-label-md">DOCX</span>
          </div>
        </div>

        {error && (
          <div className="bg-error-container text-error border border-error/20 px-4 py-3 rounded-lg text-sm">
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
            className={`col-span-12 md:col-span-8 border-2 border-dashed rounded-xl flex flex-col items-center justify-center p-xl group transition-all cursor-pointer relative overflow-hidden ${
              isDragOver 
                ? 'border-primary bg-secondary-container-flat' 
                : 'border-outline-variant bg-surface-container-lowest hover:border-primary'
            }`}
          >
            {/* Background Visual Subtle Grid */}
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#041627 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
            
            <div className="w-16 h-16 bg-primary-fixed text-primary rounded-full flex items-center justify-center mb-md group-hover:scale-110 transition-transform duration-300 shadow-sm">
              <span className="material-symbols-outlined text-3xl">upload_file</span>
            </div>

            {file ? (
              <div className="text-center space-y-xs z-10">
                <p className="font-headline-md text-headline-md text-primary truncate max-w-xs">{file.name}</p>
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  {(file.size / 1024 / 1024).toFixed(2)} MB • Ready for analysis
                </p>
                <span className="mt-md inline-block bg-primary-fixed text-primary font-label-md text-label-md px-md py-1 rounded">
                  CLICK TO CHANGE FILE
                </span>
              </div>
            ) : (
              <div className="text-center z-10">
                <p className="font-headline-md text-headline-md text-on-surface mb-xs">Click or drag files to this area to upload</p>
                <p className="font-body-sm text-body-sm text-on-surface-variant max-w-xs mx-auto">
                  Support for single PDF or Word documents. Strict enterprise encryption applied to all file transmissions.
                </p>
                <div className="mt-xl flex gap-md justify-center">
                  <div className="flex flex-col items-center gap-xs px-lg py-sm bg-surface-container border border-outline-variant rounded shadow-sm">
                    <span className="material-symbols-outlined text-primary">picture_as_pdf</span>
                    <span className="font-label-md text-label-md">Legal PDF</span>
                  </div>
                  <div className="flex flex-col items-center gap-xs px-lg py-sm bg-surface-container border border-outline-variant rounded shadow-sm">
                    <span className="material-symbols-outlined text-on-secondary-container">description</span>
                    <span className="font-label-md text-label-md">Word Doc</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Secondary Info Cards (Bento Style) */}
          <div className="col-span-12 md:col-span-4 flex flex-col gap-md">
            <div className="flex-1 bg-primary text-on-primary p-lg rounded-xl flex flex-col justify-between overflow-hidden relative shadow-md">
              <div className="z-10">
                <h3 className="font-headline-md text-headline-md mb-xs">AI Extraction</h3>
                <p className="font-body-sm text-body-sm opacity-80">
                  Our pipeline automatically resolves 50+ metadata clauses, dates, and liability limits using semantic evidence grounding.
                </p>
              </div>
              <div className="absolute bottom-0 right-0 translate-x-1/4 translate-y-1/4">
                <span className="material-symbols-outlined text-white opacity-10 text-[120px]">psychology</span>
              </div>
            </div>
            
            <div className="flex-1 bg-white border border-outline-variant p-lg rounded-xl flex flex-col justify-between shadow-sm">
              <div>
                <h3 className="font-headline-md text-headline-md text-primary mb-xs">Secure Storage</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  Files are saved securely in your isolated OCI Object Storage bucket with private encryption.
                </p>
              </div>
              <div className="flex items-center gap-sm mt-md bg-surface-container-low p-sm rounded border border-outline-variant/30">
                <span className="material-symbols-outlined text-emerald-600">verified_user</span>
                <span className="font-label-md text-[11px] text-on-surface-variant uppercase tracking-wider font-bold">AES-256 ENCRYPTED</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Right Pane: Metadata Tagging Side Panel */}
      <aside className="w-[440px] bg-white border-l border-outline-variant flex flex-col shadow-sm">
        <div className="p-lg border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
          <h2 className="font-headline-md text-headline-md text-primary">Tagging &amp; Metadata</h2>
          <span className="material-symbols-outlined text-on-surface-variant cursor-pointer">more_vert</span>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-lg space-y-lg custom-scrollbar">
            
            {/* Entity Details */}
            <div className="space-y-md">
              <p className="font-label-md text-label-md text-primary-container-flat uppercase tracking-wider font-bold">Entity Details</p>
              
              <div className="space-y-xs">
                <label className="font-label-md text-label-md text-on-surface-variant">Organization</label>
                <select 
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  className="w-full bg-surface-container-low border-b-2 border-outline-variant focus:border-primary border-t-0 border-x-0 rounded-none py-sm font-body-md text-body-md focus:ring-0 outline-none"
                >
                  <option>LexIntel Corporate</option>
                  <option>Global Holdings LLC</option>
                  <option>Strategic Partners Inc.</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-md">
                <div className="space-y-xs">
                  <label className="font-label-md text-label-md text-on-surface-variant">Business Unit</label>
                  <input 
                    type="text"
                    value={businessUnit}
                    onChange={(e) => setBusinessUnit(e.target.value)}
                    placeholder="e.g. Finance" 
                    className="w-full bg-surface-container-low border-b-2 border-outline-variant focus:border-primary border-t-0 border-x-0 rounded-none py-sm font-body-md text-body-md focus:ring-0 outline-none placeholder:text-outline"
                  />
                </div>
                <div className="space-y-xs">
                  <label className="font-label-md text-label-md text-on-surface-variant">Location</label>
                  <input 
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="New York, NY" 
                    className="w-full bg-surface-container-low border-b-2 border-outline-variant focus:border-primary border-t-0 border-x-0 rounded-none py-sm font-body-md text-body-md focus:ring-0 outline-none placeholder:text-outline"
                  />
                </div>
              </div>

              <div className="space-y-xs">
                <label className="font-label-md text-label-md text-on-surface-variant">Department</label>
                <input 
                  type="text"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  placeholder="Legal Operations" 
                  className="w-full bg-surface-container-low border-b-2 border-outline-variant focus:border-primary border-t-0 border-x-0 rounded-none py-sm font-body-md text-body-md focus:ring-0 outline-none placeholder:text-outline"
                />
              </div>
            </div>

            <hr className="border-outline-variant" />

            {/* Contract Context */}
            <div className="space-y-md">
              <p className="font-label-md text-label-md text-primary-container-flat uppercase tracking-wider font-bold">Contractual Context</p>
              
              <div className="space-y-xs">
                <label className="font-label-md text-label-md text-on-surface-variant">Customer/Partner Name (Client)</label>
                <input 
                  type="text"
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="e.g. Apex Financial Group" 
                  className="w-full bg-surface-container-low border-b-2 border-outline-variant focus:border-primary border-t-0 border-x-0 rounded-none py-sm font-body-md text-body-md focus:ring-0 outline-none placeholder:text-outline"
                />
              </div>

              <div className="grid grid-cols-2 gap-md">
                <div className="space-y-xs">
                  <label className="font-label-md text-label-md text-on-surface-variant">Financial Year</label>
                  <select 
                    value={financialYear}
                    onChange={(e) => setFinancialYear(e.target.value)}
                    className="w-full bg-surface-container-low border-b-2 border-outline-variant focus:border-primary border-t-0 border-x-0 rounded-none py-sm font-body-md text-body-md focus:ring-0 outline-none"
                  >
                    <option>FY 2024</option>
                    <option>FY 2023</option>
                    <option>FY 2025</option>
                  </select>
                </div>
                <div className="space-y-xs">
                  <label className="font-label-md text-label-md text-on-surface-variant">Contract Type</label>
                  <select 
                    value={contractType}
                    onChange={(e) => setContractType(e.target.value)}
                    className="w-full bg-surface-container-low border-b-2 border-outline-variant focus:border-primary border-t-0 border-x-0 rounded-none py-sm font-body-md text-body-md focus:ring-0 outline-none"
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
                <label className="font-label-md text-label-md text-on-surface-variant">Agreement Type</label>
                <input 
                  type="text"
                  value={agreementType}
                  onChange={(e) => setAgreementType(e.target.value)}
                  placeholder="Master Service Agreement (MSA)" 
                  className="w-full bg-surface-container-low border-b-2 border-outline-variant focus:border-primary border-t-0 border-x-0 rounded-none py-sm font-body-md text-body-md focus:ring-0 outline-none placeholder:text-outline"
                />
              </div>

              <div className="space-y-xs">
                <label className="font-label-md text-label-md text-on-surface-variant">Additional Info (Notes)</label>
                <textarea 
                  value={additionalInfo}
                  onChange={(e) => setAdditionalInfo(e.target.value)}
                  placeholder="Notes on urgency, specific clause exceptions, or internal references..." 
                  rows={3}
                  className="w-full bg-surface-container-low border-b-2 border-outline-variant focus:border-primary border-t-0 border-x-0 rounded-none py-sm font-body-md text-body-md resize-none focus:ring-0 outline-none placeholder:text-outline"
                ></textarea>
              </div>
            </div>
          </div>

          {/* Sticky Footer Action */}
          <div className="p-lg bg-white border-t border-outline-variant mt-auto">
            <button 
              type="submit"
              className="w-full py-md bg-primary text-on-primary rounded-lg font-headline-md text-headline-md hover:bg-primary-container active:scale-[0.98] transition-all shadow-md flex items-center justify-center gap-xs duration-150"
            >
              <span className="material-symbols-outlined text-[20px]">auto_awesome</span>
              Submit &amp; Start Extraction
            </button>
          </div>
        </form>
      </aside>
    </main>
  );
}
