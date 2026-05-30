import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import api from '../services/api';

interface ParameterSchema {
  schema_id: string;
  name: string;
  logic: string | null;
  contract_types: string | null;
  category: 'Commercial' | 'Vendor' | 'Internal' | null;
  priority: 'High' | 'Med' | 'Low' | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface SchemaPayload {
  name: string;
  logic: string;
  contract_types: string;
  category: 'Commercial' | 'Vendor' | 'Internal';
  priority: 'High' | 'Med' | 'Low';
}

const EMPTY_FORM: SchemaPayload = {
  name: '',
  logic: '',
  contract_types: 'MSA, SOW',
  category: 'Commercial',
  priority: 'High',
};

const CONTRACT_TYPE_PRESETS: Record<string, string> = {
  'Master Service Agreement': 'MSA, SOW',
  'Non-Disclosure Agreement': 'NDA',
  'Employment Contract':      'Employment',
  'Real Estate Lease':        'Lease',
};

export default function Admin() {
  const user        = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId]           = useState<string | null>(null);
  const [form, setForm]                        = useState<SchemaPayload>(EMPTY_FORM);
  const [contractTypePreset, setContractTypePreset] = useState('Master Service Agreement');
  const [searchQuery, setSearchQuery]          = useState('');
  const [toastMsg, setToastMsg]                = useState<string | null>(null);

  // ── Access guard ───────────────────────────────────────────────────────────
  if (user?.role !== 'admin') {
    return (
      <div className="p-lg max-w-[800px] mx-auto text-center mt-12">
        <div className="bg-surface-container-lowest border border-outline-variant p-xl rounded-xl shadow-sm">
          <span className="material-symbols-outlined text-[64px] text-error mb-md">admin_panel_settings</span>
          <h2 className="font-headline-lg text-headline-lg text-primary mb-sm">Administrator Access Only</h2>
          <p className="text-on-surface-variant font-body-md">
            This administration portal is restricted to system administrators. Log in with an administrator account to configure global data extraction schemas.
          </p>
        </div>
      </div>
    );
  }

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data: schemas = [], isLoading, error } = useQuery<ParameterSchema[]>({
    queryKey: ['parameter-schemas'],
    queryFn: async () => {
      const res = await api.get('/admin/parameter-schemas');
      return res.data;
    },
  });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const createMutation = useMutation({
    mutationFn: (payload: SchemaPayload) => api.post('/admin/parameter-schemas', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parameter-schemas'] });
      resetForm();
      showToast('Parameter schema created.');
    },
    onError: (err: any) => {
      alert(`Create failed: ${err?.response?.data?.detail || err.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ schema_id, payload }: { schema_id: string; payload: SchemaPayload }) =>
      api.put(`/admin/parameter-schemas/${schema_id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parameter-schemas'] });
      showToast('Parameter schema updated.');
    },
    onError: (err: any) => {
      alert(`Update failed: ${err?.response?.data?.detail || err.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (schema_id: string) => api.delete(`/admin/parameter-schemas/${schema_id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parameter-schemas'] });
      resetForm();
      showToast('Parameter schema deleted.');
    },
    onError: (err: any) => {
      alert(`Delete failed: ${err?.response?.data?.detail || err.message}`);
    },
  });

  // ── Form helpers ───────────────────────────────────────────────────────────
  const resetForm = () => {
    setSelectedId(null);
    setForm(EMPTY_FORM);
    setContractTypePreset('Master Service Agreement');
  };

  const handleSelectRow = (schema: ParameterSchema) => {
    setSelectedId(schema.schema_id);
    setForm({
      name:           schema.name,
      logic:          schema.logic ?? '',
      contract_types: schema.contract_types ?? '',
      category:       (schema.category as 'Commercial' | 'Vendor' | 'Internal') ?? 'Commercial',
      priority:       (schema.priority as 'High' | 'Med' | 'Low') ?? 'High',
    });
    // Best-effort reverse-map preset
    const match = Object.entries(CONTRACT_TYPE_PRESETS).find(([, v]) => v === schema.contract_types);
    setContractTypePreset(match ? match[0] : 'Master Service Agreement');
  };

  const handlePresetChange = (preset: string) => {
    setContractTypePreset(preset);
    setForm((f) => ({ ...f, contract_types: CONTRACT_TYPE_PRESETS[preset] ?? f.contract_types }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      alert('Parameter Head/Name is required');
      return;
    }
    if (selectedId) {
      updateMutation.mutate({ schema_id: selectedId, payload: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(schemas, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'plexus_extraction_schema.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Filtered view ──────────────────────────────────────────────────────────
  const filteredSchemas = schemas.filter((s) => {
    const q = searchQuery.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      (s.logic ?? '').toLowerCase().includes(q) ||
      (s.contract_types ?? '').toLowerCase().includes(q)
    );
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-lg flex-1 flex flex-col h-[calc(100vh-56px)] max-w-[1400px] mx-auto w-full overflow-y-auto custom-scrollbar relative">
      {/* Background soft gradient */}
      <div className="fixed top-0 right-0 w-1/3 h-1/2 bg-gradient-to-bl from-primary/5 to-transparent -z-10 pointer-events-none" />

      {/* Toast notification */}
      {toastMsg && (
        <div className="fixed top-4 right-4 z-50 bg-primary text-on-primary px-lg py-sm rounded-lg shadow-xl font-label-md flex items-center gap-xs animate-in slide-in-from-right-4">
          <span className="material-symbols-outlined text-[18px]">check_circle</span>
          {toastMsg}
        </div>
      )}

      {/* Page Header */}
      <div className="flex justify-between items-end mb-lg">
        <div>
          <h1 className="font-display-sm text-display-sm text-primary">Extraction Master Maintenance</h1>
          <p className="text-on-surface-variant font-body-md">Configure data point logic and association types for automated AI processing.</p>
        </div>
        <div className="flex gap-sm">
          <button
            onClick={handleExport}
            className="px-md py-sm border border-outline-variant rounded-lg font-label-md text-label-md hover:bg-surface-container-low transition-all bg-surface-container-lowest text-primary"
          >
            Export Schema
          </button>
          <button
            onClick={resetForm}
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
              {selectedId ? 'Edit Parameter' : 'New Parameter'}
            </h3>

            <form onSubmit={handleSubmit} className="space-y-md">
              {/* Parameter Head */}
              <div className="space-y-xs">
                <label className="font-label-md text-label-md text-on-surface-variant block">Parameter Head</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g., Termination Clause"
                  className="w-full bg-surface-container-low border-none rounded-lg font-body-sm py-sm px-md focus:ring-1 focus:ring-primary focus:outline-none"
                />
              </div>

              {/* Contract Type Preset Dropdown */}
              <div className="space-y-xs">
                <label className="font-label-md text-label-md text-on-surface-variant block">Contract Association Preset</label>
                <select
                  value={contractTypePreset}
                  onChange={(e) => handlePresetChange(e.target.value)}
                  className="w-full bg-surface-container-low border-none rounded-lg font-body-sm py-sm px-md focus:ring-1 focus:ring-primary focus:outline-none"
                >
                  {Object.keys(CONTRACT_TYPE_PRESETS).map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
                {/* Editable contract_types raw value */}
                <input
                  type="text"
                  value={form.contract_types}
                  onChange={(e) => setForm((f) => ({ ...f, contract_types: e.target.value }))}
                  placeholder="MSA, SOW, NDA …"
                  className="w-full bg-surface-container-low border-none rounded-lg font-body-sm py-xs px-md focus:ring-1 focus:ring-primary focus:outline-none text-secondary"
                />
              </div>

              {/* Agreement Category Pill Toggles */}
              <div className="space-y-xs">
                <label className="font-label-md text-label-md text-on-surface-variant block">Agreement Category</label>
                <div className="flex gap-xs">
                  {(['Commercial', 'Vendor', 'Internal'] as const).map((cat) => (
                    <span
                      key={cat}
                      onClick={() => setForm((f) => ({ ...f, category: cat }))}
                      className={`px-sm py-1 rounded-full text-label-md cursor-pointer transition-colors ${
                        form.category === cat
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
                      onClick={() => setForm((f) => ({ ...f, priority: pri }))}
                      className={`px-sm py-1 rounded-full text-label-md cursor-pointer transition-colors ${
                        form.priority === pri
                          ? 'bg-error-container text-on-error-container font-bold'
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
                  value={form.logic}
                  onChange={(e) => setForm((f) => ({ ...f, logic: e.target.value }))}
                  placeholder="P1 + P2 + P3"
                  className="w-full bg-surface-container-low border-none rounded-lg font-mono-md text-mono-md py-sm px-md focus:ring-1 focus:ring-primary focus:outline-none font-bold"
                />
                <p className="text-[10px] text-outline italic">Use coordinate arithmetic symbols for combined metadata tags.</p>
              </div>

              {/* Actions */}
              <div className="pt-sm flex gap-xs">
                {selectedId && (
                  <>
                    <button
                      type="button"
                      onClick={resetForm}
                      className="flex-1 py-md border border-outline-variant rounded-lg font-label-md text-label-md text-primary hover:bg-surface-container-low transition-all"
                    >
                      Clear Form
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm('Delete this parameter schema permanently?')) {
                          deleteMutation.mutate(selectedId);
                        }
                      }}
                      disabled={deleteMutation.isPending}
                      className="flex-none px-md py-md border border-error/40 text-error rounded-lg font-label-md text-label-md hover:bg-error-container transition-all"
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                  </>
                )}
                <button
                  type="submit"
                  disabled={isPending}
                  className="flex-1 py-md bg-secondary text-on-secondary rounded-lg font-label-md text-label-md shadow-sm hover:opacity-90 active:scale-[0.99] transition-all font-bold"
                >
                  {isPending ? 'Saving…' : selectedId ? 'Update Parameter' : 'Define Parameter'}
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
                  <div className="h-full bg-on-primary w-[98%] rounded-full" />
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
                  onClick={handleExport}
                  className="p-xs hover:bg-surface-container-high rounded transition-colors material-symbols-outlined text-[18px]"
                  title="Download JSON schema"
                >
                  download
                </button>
              </div>
            </div>

            {/* Parameter Schema Table */}
            <div className="flex-1 overflow-x-auto">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center h-48 gap-sm text-on-surface-variant">
                  <span className="material-symbols-outlined animate-spin text-[40px]">sync</span>
                  <span className="font-label-md">Loading from Oracle 26ai…</span>
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center h-48 gap-sm text-error">
                  <span className="material-symbols-outlined text-[40px]">error</span>
                  <span className="font-label-md">Failed to load parameter schemas</span>
                </div>
              ) : (
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
                    {filteredSchemas.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-on-surface-variant font-body-md">
                          No parameter schemas defined yet. Use the form on the left to create the first one.
                        </td>
                      </tr>
                    ) : (
                      filteredSchemas.map((schema) => {
                        const priorityColor =
                          schema.priority === 'High'
                            ? 'text-on-error-container bg-error-container/30'
                            : schema.priority === 'Med'
                            ? 'text-on-primary-container bg-primary-container/10'
                            : 'text-secondary bg-surface-container-highest';

                        const categoryDot =
                          schema.category === 'Commercial'
                            ? 'bg-blue-500'
                            : schema.category === 'Vendor'
                            ? 'bg-purple-500'
                            : 'bg-emerald-500';

                        return (
                          <tr
                            key={schema.schema_id}
                            className={`hover:bg-surface-container-low/40 transition-colors group cursor-pointer ${
                              selectedId === schema.schema_id ? 'bg-primary-fixed/20' : ''
                            }`}
                            onClick={() => handleSelectRow(schema)}
                          >
                            <td className="px-lg py-md font-body-sm font-bold text-primary">{schema.name}</td>
                            <td className="px-lg py-md">
                              <span className="font-mono-md text-mono-md bg-surface-container px-sm py-0.5 rounded text-secondary font-bold select-all">
                                {schema.logic || '—'}
                              </span>
                            </td>
                            <td className="px-lg py-md">
                              <div className="flex items-center gap-xs">
                                <span className={`w-2 h-2 rounded-full ${categoryDot}`} />
                                <span className="font-body-sm text-secondary">
                                  {schema.contract_types || '—'}
                                </span>
                              </div>
                            </td>
                            <td className="px-lg py-md text-center">
                              <span className={`text-[11px] font-bold px-2 py-1 rounded tracking-wide ${priorityColor}`}>
                                {schema.priority ?? '—'}
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
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>

            {/* Count bar */}
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
