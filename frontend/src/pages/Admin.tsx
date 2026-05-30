import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';

interface ParameterSchema {
  id: string;
  name: string;
  logic: string;
  contractTypes: string[];
  category: 'Commercial' | 'Vendor' | 'Internal';
  priority: 'High' | 'Med' | 'Low';
}

const DEFAULT_SCHEMAS: ParameterSchema[] = [
  {
    id: '1',
    name: 'Liability Cap',
    logic: 'P1 + P4 + P9',
    contractTypes: ['MSA', 'SOW'],
    category: 'Commercial',
    priority: 'High',
  },
  {
    id: '2',
    name: 'Notice Period',
    logic: 'P2 + P3',
    contractTypes: ['Employment', 'Lease'],
    category: 'Internal',
    priority: 'Med',
  },
  {
    id: '3',
    name: 'Governing Law',
    logic: 'P11',
    contractTypes: ['All Global'],
    category: 'Commercial',
    priority: 'High',
  },
  {
    id: '4',
    name: 'Force Majeure',
    logic: 'P15 + P16',
    contractTypes: ['Procurement'],
    category: 'Vendor',
    priority: 'Low',
  },
  {
    id: '5',
    name: 'Renewal Rights',
    logic: 'P22 + P24',
    contractTypes: ['SaaS', 'Lease'],
    category: 'Commercial',
    priority: 'High',
  },
];

export default function Admin() {
  const user = useAuthStore((state) => state.user);

  // Schema state
  const [schemas, setSchemas] = useState<ParameterSchema[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Form state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formLogic, setFormLogic] = useState('');
  const [formContractType, setFormContractType] = useState('Master Service Agreement');
  const [formCategory, setFormCategory] = useState<'Commercial' | 'Vendor' | 'Internal'>('Commercial');
  const [formPriority, setFormPriority] = useState<'High' | 'Med' | 'Low'>('High');

  // Load schemas from localStorage or defaults
  useEffect(() => {
    const saved = localStorage.getItem('plexus_parameter_schemas');
    if (saved) {
      try {
        setSchemas(JSON.parse(saved));
      } catch {
        setSchemas(DEFAULT_SCHEMAS);
      }
    } else {
      setSchemas(DEFAULT_SCHEMAS);
      localStorage.setItem('plexus_parameter_schemas', JSON.stringify(DEFAULT_SCHEMAS));
    }
  }, []);

  // Save utility
  const saveSchemas = (updated: ParameterSchema[]) => {
    setSchemas(updated);
    localStorage.setItem('plexus_parameter_schemas', JSON.stringify(updated));
  };

  const handleSelectRow = (schema: ParameterSchema) => {
    setSelectedId(schema.id);
    setFormName(schema.name);
    setFormLogic(schema.logic);
    
    // Map existing types back
    if (schema.contractTypes.includes('MSA') || schema.contractTypes.includes('SOW')) {
      setFormContractType('Master Service Agreement');
    } else if (schema.contractTypes.includes('Employment')) {
      setFormContractType('Employment Contract');
    } else if (schema.contractTypes.includes('Lease')) {
      setFormContractType('Real Estate Lease');
    } else {
      setFormContractType('Non-Disclosure Agreement');
    }
    
    setFormCategory(schema.category);
    setFormPriority(schema.priority);
  };

  const handleCreateNew = () => {
    setSelectedId(null);
    setFormName('');
    setFormLogic('');
    setFormContractType('Master Service Agreement');
    setFormCategory('Commercial');
    setFormPriority('High');
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      alert('Parameter Head/Name is required');
      return;
    }

    const typeMapping: Record<string, string[]> = {
      'Master Service Agreement': ['MSA', 'SOW'],
      'Non-Disclosure Agreement': ['NDA'],
      'Employment Contract': ['Employment'],
      'Real Estate Lease': ['Lease']
    };

    const types = typeMapping[formContractType] || ['General'];

    if (selectedId) {
      // Update existing
      const updated = schemas.map(s => {
        if (s.id === selectedId) {
          return {
            ...s,
            name: formName,
            logic: formLogic || 'P1',
            contractTypes: types,
            category: formCategory,
            priority: formPriority
          };
        }
        return s;
      });
      saveSchemas(updated);
      alert('Parameter updated in master log.');
    } else {
      // Create new
      const newSchema: ParameterSchema = {
        id: Date.now().toString(),
        name: formName,
        logic: formLogic || 'P1',
        contractTypes: types,
        category: formCategory,
        priority: formPriority
      };
      saveSchemas([...schemas, newSchema]);
      handleCreateNew();
      alert('New extraction parameter defined successfully.');
    }
  };

  const handleExportSchema = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(schemas, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', 'plexus_extraction_schema.json');
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  if (user?.role !== 'admin') {
    return (
      <div className="p-lg max-w-[800px] mx-auto text-center mt-12">
        <div className="bg-surface-container-lowest border border-outline-variant p-xl rounded-xl shadow-sm">
          <span className="material-symbols-outlined text-[64px] text-error mb-md">admin_panel_settings</span>
          <h2 className="font-headline-lg text-headline-lg text-primary mb-sm">Administrator Access Only</h2>
          <p className="text-on-surface-variant font-body-md">
            This administration portal is restricted to system administrators. Please log in with an administrator account to configure global data extraction schemas.
          </p>
        </div>
      </div>
    );
  }

  // Filter list
  const filteredSchemas = schemas.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.logic.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.contractTypes.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="p-lg flex-1 flex flex-col h-[calc(100vh-56px)] max-w-[1400px] mx-auto w-full overflow-y-auto custom-scrollbar relative">
      {/* Background soft gradient */}
      <div className="fixed top-0 right-0 w-1/3 h-1/2 bg-gradient-to-bl from-primary/5 to-transparent -z-10 pointer-events-none" />

      {/* Page Header */}
      <div className="flex justify-between items-end mb-lg">
        <div>
          <h2 className="font-headline-lg text-headline-lg text-primary font-bold">Extraction Master Maintenance</h2>
          <p className="text-on-surface-variant font-body-md">Configure data point logic and association types for automated AI processing.</p>
        </div>
        <div className="flex gap-sm">
          <button 
            onClick={handleExportSchema}
            className="px-md py-sm border border-outline-variant rounded-lg font-label-md text-label-md hover:bg-surface-container-low transition-all bg-surface-container-lowest text-primary"
          >
            Export Schema
          </button>
          <button 
            onClick={handleCreateNew}
            className="px-md py-sm bg-primary text-on-primary rounded-lg font-label-md text-label-md flex items-center gap-xs shadow-sm hover:opacity-90 active:scale-95 transition-all"
          >
            <span className="material-symbols-outlined text-[16px]">add_box</span> Define Parameter
          </button>
        </div>
      </div>

      {/* Main Grid Section */}
      <div className="grid grid-cols-12 gap-lg mb-lg">
        {/* Definition Form Panel (Left) */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-lg">
          <div className="bg-surface-container-lowest p-lg rounded-xl border border-outline-variant shadow-sm flex flex-col gap-md">
            <h3 className="font-headline-md text-headline-md text-primary flex items-center gap-xs">
              <span className="material-symbols-outlined text-primary">settings_input_component</span>
              Extraction Logic
            </h3>
            
            <form onSubmit={handleSaveForm} className="space-y-md">
              {/* Parameter Head */}
              <div className="space-y-xs">
                <label className="font-label-md text-label-md text-on-surface-variant block">Parameter Head</label>
                <input 
                  type="text" 
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g., Termination Clause" 
                  className="w-full bg-surface-container-low border-none rounded-lg font-body-sm py-sm px-md focus:ring-1 focus:ring-primary focus:outline-none"
                />
              </div>

              {/* Contract Type Dropdown */}
              <div className="space-y-xs">
                <label className="font-label-md text-label-md text-on-surface-variant block">Contract Association</label>
                <select 
                  value={formContractType}
                  onChange={(e) => setFormContractType(e.target.value)}
                  className="w-full bg-surface-container-low border-none rounded-lg font-body-sm py-sm px-md focus:ring-1 focus:ring-primary focus:outline-none"
                >
                  <option>Master Service Agreement</option>
                  <option>Non-Disclosure Agreement</option>
                  <option>Employment Contract</option>
                  <option>Real Estate Lease</option>
                </select>
              </div>

              {/* Agreement Category Pill Toggles */}
              <div className="space-y-xs">
                <label className="font-label-md text-label-md text-on-surface-variant block">Agreement Category</label>
                <div className="flex gap-xs">
                  {(['Commercial', 'Vendor', 'Internal'] as const).map((cat) => (
                    <span 
                      key={cat}
                      onClick={() => setFormCategory(cat)}
                      className={`px-sm py-1 rounded-full text-label-md cursor-pointer transition-colors ${
                        formCategory === cat 
                          ? 'bg-secondary-container text-on-secondary-container font-bold'
                          : 'bg-surface-container-high text-secondary hover:bg-secondary-container/50'
                      }`}
                    >
                      {cat}
                    </span>
                  ))}
                </div>
              </div>

              {/* Priority */}
              <div className="space-y-xs">
                <label className="font-label-md text-label-md text-on-surface-variant block">Evaluation Priority</label>
                <div className="flex gap-xs">
                  {(['High', 'Med', 'Low'] as const).map((pri) => (
                    <span 
                      key={pri}
                      onClick={() => setFormPriority(pri)}
                      className={`px-sm py-1 rounded-full text-label-md cursor-pointer transition-colors ${
                        formPriority === pri 
                          ? 'bg-error-container text-on-error-container font-bold border border-error-container'
                          : 'bg-surface-container-high text-secondary hover:bg-error-container/20'
                      }`}
                    >
                      {pri}
                    </span>
                  ))}
                </div>
              </div>

              {/* Extraction Logic expression */}
              <div className="space-y-xs">
                <label className="font-label-md text-label-md text-on-surface-variant block">Parameter Logic (OCR Mapping)</label>
                <input 
                  type="text" 
                  value={formLogic}
                  onChange={(e) => setFormLogic(e.target.value)}
                  placeholder="P1 + P2 + P3" 
                  className="w-full bg-surface-container-low border-none rounded-lg font-mono-md text-mono-md py-sm px-md focus:ring-1 focus:ring-primary focus:outline-none font-bold"
                />
                <p className="text-[10px] text-outline italic">Use coordinate arithmetic symbols for combined metadata tags.</p>
              </div>

              {/* Actions */}
              <div className="pt-sm flex gap-xs">
                {selectedId && (
                  <button 
                    type="button"
                    onClick={handleCreateNew}
                    className="flex-1 py-md border border-outline-variant rounded-lg font-label-md text-label-md text-primary hover:bg-surface-container-low transition-all"
                  >
                    Clear Form
                  </button>
                )}
                <button 
                  type="submit"
                  className="flex-1 py-md bg-secondary text-on-secondary rounded-lg font-label-md text-label-md shadow-sm hover:opacity-90 active:scale-[0.99] transition-all font-bold"
                >
                  {selectedId ? 'Update Parameter' : 'Define Parameter'}
                </button>
              </div>
            </form>
          </div>

          {/* Stats Card */}
          <div className="bg-primary text-on-primary p-lg rounded-xl shadow-lg relative overflow-hidden group">
            <div className="relative z-10">
              <p className="font-label-md text-label-md opacity-80 uppercase tracking-widest">Global Extraction Accuracy</p>
              <h4 className="text-display-sm font-display-sm mt-xs">98.4%</h4>
              <div className="mt-md flex items-center gap-sm">
                <div className="flex-1 h-1.5 bg-on-primary/20 rounded-full overflow-hidden">
                  <div className="h-full bg-on-primary w-[98%] rounded-full"></div>
                </div>
                <span className="text-body-sm font-mono">+2.1% WoW</span>
              </div>
            </div>
            <span className="material-symbols-outlined absolute -right-4 -bottom-4 text-[120px] opacity-10 group-hover:rotate-12 transition-transform duration-700 select-none">
              query_stats
            </span>
          </div>
        </div>

        {/* Main Data Table Panel (Right) */}
        <div className="col-span-12 lg:col-span-8 flex flex-col">
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden flex flex-col h-full min-h-[450px]">
            {/* Header / Filter Toolbar */}
            <div className="px-lg py-md border-b border-outline-variant flex justify-between items-center bg-surface-container-low/30">
              <div className="flex items-center gap-md flex-1">
                <h3 className="font-label-md text-label-md text-primary uppercase tracking-wider whitespace-nowrap">Active Parameter Schema</h3>
                
                {/* Search Schema */}
                <div className="relative flex-1 max-w-xs">
                  <span className="absolute left-sm top-1/2 -translate-y-1/2 material-symbols-outlined text-outline text-[18px]">search</span>
                  <input 
                    type="text" 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search Schema Parameters..." 
                    className="pl-xl pr-md py-xs bg-surface-container-low border-none rounded-lg text-body-sm focus:ring-1 focus:ring-primary w-full focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex gap-xs">
                <button className="p-xs hover:bg-surface-container-high rounded transition-colors material-symbols-outlined text-[18px]">filter_list</button>
                <button 
                  onClick={handleExportSchema} 
                  className="p-xs hover:bg-surface-container-high rounded transition-colors material-symbols-outlined text-[18px]"
                  title="Download JSON schema"
                >
                  download
                </button>
              </div>
            </div>

            {/* Parameter Schema Table */}
            <div className="flex-1 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low border-b border-outline-variant">
                    <th className="px-lg py-sm font-label-md text-label-md text-secondary uppercase whitespace-nowrap">Parameter Head</th>
                    <th className="px-lg py-sm font-label-md text-label-md text-secondary uppercase whitespace-nowrap">Parameter Logic</th>
                    <th className="px-lg py-sm font-label-md text-label-md text-secondary uppercase whitespace-nowrap">Contract Association</th>
                    <th className="px-lg py-sm font-label-md text-label-md text-secondary uppercase whitespace-nowrap text-center">Priority</th>
                    <th className="px-lg py-sm font-label-md text-label-md text-secondary uppercase whitespace-nowrap text-right w-16">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {filteredSchemas.map((schema) => {
                    const priorityColor = schema.priority === 'High' 
                      ? 'text-on-error-container bg-error-container/30'
                      : schema.priority === 'Med'
                        ? 'text-on-primary-container bg-primary-container/10'
                        : 'text-secondary bg-surface-container-highest';

                    return (
                      <tr 
                        key={schema.id}
                        className={`hover:bg-surface-container-low/40 transition-colors group cursor-pointer ${
                          selectedId === schema.id ? 'bg-primary-fixed/20' : ''
                        }`}
                        onClick={() => handleSelectRow(schema)}
                      >
                        <td className="px-lg py-md font-body-sm font-bold text-primary">
                          {schema.name}
                        </td>
                        <td className="px-lg py-md">
                          <span className="font-mono-md text-mono-md bg-surface-container px-sm py-0.5 rounded text-secondary font-bold select-all">
                            {schema.logic}
                          </span>
                        </td>
                        <td className="px-lg py-md">
                          <div className="flex items-center gap-xs">
                            <span className={`w-2 h-2 rounded-full ${
                              schema.category === 'Commercial' 
                                ? 'bg-blue-500' 
                                : schema.category === 'Vendor' 
                                  ? 'bg-purple-500' 
                                  : 'bg-emerald-500'
                            }`} />
                            <span className="font-body-sm text-secondary">
                              {schema.contractTypes.join(', ')}
                            </span>
                          </div>
                        </td>
                        <td className="px-lg py-md text-center">
                          <span className={`text-[11px] font-bold px-2 py-1 rounded tracking-wide ${priorityColor}`}>
                            {schema.priority}
                          </span>
                        </td>
                        <td className="px-lg py-md text-right">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectRow(schema);
                            }}
                            className="material-symbols-outlined hover:text-primary transition-colors text-outline"
                          >
                            edit_square
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination / Total count bar */}
            <div className="mt-auto px-lg py-md bg-surface-container-low border-t border-outline-variant flex justify-between items-center">
              <span className="font-body-sm text-secondary">
                Showing {filteredSchemas.length} of {schemas.length} Global Extraction Rules
              </span>
              <div className="flex gap-xs">
                <button className="p-xs border border-outline-variant rounded hover:bg-surface-container-high transition-all material-symbols-outlined">chevron_left</button>
                <button className="p-xs border border-outline-variant rounded hover:bg-surface-container-high transition-all material-symbols-outlined">chevron_right</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Contextual Documentation Panel at bottom */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-lg mt-md">
        <div className="custom-glass p-md rounded-xl border border-outline-variant/30 flex gap-md items-start bg-surface-container-lowest/50">
          <div className="p-sm bg-primary-fixed rounded-lg text-primary flex items-center justify-center">
            <span className="material-symbols-outlined">auto_stories</span>
          </div>
          <div>
            <h4 className="font-label-md text-label-md text-primary font-bold">OCR Pattern Logic</h4>
            <p className="font-body-sm text-on-surface-variant mt-xs">
              Combined parameters use weighted proximity search to validate data strings across multiple document pages.
            </p>
          </div>
        </div>
        
        <div className="custom-glass p-md rounded-xl border border-outline-variant/30 flex gap-md items-start bg-surface-container-lowest/50">
          <div className="p-sm bg-tertiary-fixed rounded-lg text-tertiary flex items-center justify-center">
            <span className="material-symbols-outlined">schema</span>
          </div>
          <div>
            <h4 className="font-label-md text-label-md text-primary font-bold">Type Hierarchies</h4>
            <p className="font-body-sm text-on-surface-variant mt-xs">
              Changes here propagate immediately to the Review workspace queue for all subsequent document parsing jobs.
            </p>
          </div>
        </div>

        <div className="custom-glass p-md rounded-xl border border-outline-variant/30 flex gap-md items-start bg-surface-container-lowest/50">
          <div className="p-sm bg-error-container rounded-lg text-on-error-container flex items-center justify-center">
            <span className="material-symbols-outlined">history</span>
          </div>
          <div>
            <h4 className="font-label-md text-label-md text-primary font-bold">Maintenance Audit</h4>
            <p className="font-body-sm text-on-surface-variant mt-xs">
              Oracle 26ai records a systemic log of all parameter additions and updates, allowing audit rollback features.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
