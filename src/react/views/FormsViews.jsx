// React-island migration — Forms chunk views: Lead Forms, Surveys, Contracts.
//
// All three are render-from-data screens in chunks/script-forms.js. The chunk
// fetches the rows (lead_forms / surveys / contracts) and passes them as props;
// these islands render the header + card grid / table + empty state, reproducing
// the exact legacy markup. The builder/submissions/detail MODALS stay vanilla
// (row/card buttons call window.app.*). No React Query (data via props).

const app = () => window.app || {};
const wrap = { padding: '24px', maxWidth: '1000px', margin: '0 auto' };
const headRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' };
const h1s = { fontSize: '24px', fontWeight: 700, margin: 0 };
const subP = { color: 'var(--gray-500)', margin: '4px 0 0' };
const emptyBox = { textAlign: 'center', padding: '60px', background: 'white', border: '1px solid var(--gray-200)', borderRadius: '12px', color: 'var(--gray-400)' };
const card = { background: 'white', border: '1px solid var(--gray-200)', borderRadius: '12px', padding: '20px' };
const cardHead = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' };
const badge = (on) => ({ padding: '3px 10px', borderRadius: '20px', fontSize: '12px', background: on ? '#d1fae5' : '#f3f4f6', color: on ? '#065f46' : '#6b7280' });
const actionRow = { display: 'flex', gap: '8px', flexWrap: 'wrap' };
const btnFlex = { flex: 1, fontSize: '12px', padding: '6px' };

// ── Lead Forms ────────────────────────────────────────────────────────────────
export function LeadFormsView({ forms = [] }) {
    window.__REACT_LEADFORMS_STATE = 'ready'; window.__REACT_LEADFORMS_ROWS = forms.length;
    return (
        <div style={wrap}>
            <div style={headRow}>
                <div>
                    <h1 style={h1s}>Lead Capture Forms</h1>
                    <p style={subP}>Shareable forms that auto-create prospects when submitted.</p>
                </div>
                <button className="btn primary" onClick={() => app().openFormBuilderModal && app().openFormBuilderModal()}><i className="fas fa-plus"></i> New Form</button>
            </div>
            {forms.length === 0 ? (
                <div style={emptyBox}>
                    <i className="fas fa-wpforms" style={{ fontSize: '48px', display: 'block', marginBottom: '12px' }}></i>
                    <h3 style={{ color: 'var(--gray-500)' }}>No forms yet</h3>
                    <p>Create your first lead capture form to start collecting prospects automatically.</p>
                    <button className="btn primary" onClick={() => app().openFormBuilderModal && app().openFormBuilderModal()}>Create Form</button>
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
                    {forms.map((form) => (
                        <div key={form.id} style={card}>
                            <div style={cardHead}>
                                <div>
                                    <h3 style={{ margin: 0, fontSize: '16px' }}>{form.name}</h3>
                                    <p style={{ margin: '4px 0 0', color: 'var(--gray-500)', fontSize: '13px' }}>{form.description || 'No description'}</p>
                                </div>
                                <span style={badge(form.is_active)}>{form.is_active ? 'Active' : 'Inactive'}</span>
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginBottom: '16px' }}>{(form.fields || []).length} fields</div>
                            <div style={actionRow}>
                                <button className="btn secondary" style={btnFlex} onClick={() => app().copyFormLink && app().copyFormLink(form.id)}><i className="fas fa-copy"></i> Copy Link</button>
                                <button className="btn secondary" style={btnFlex} onClick={() => app().showFormSubmissions && app().showFormSubmissions(form.id)}><i className="fas fa-inbox"></i> Submissions</button>
                                <button className="btn-icon" style={{ color: 'var(--error)' }} onClick={() => app().deleteLeadForm && app().deleteLeadForm(form.id)}><i className="fas fa-trash"></i></button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Surveys ─────────────────────────────────────────────────────────────────--
export function SurveysView({ surveys = [] }) {
    window.__REACT_SURVEYS_STATE = 'ready'; window.__REACT_SURVEYS_ROWS = surveys.length;
    return (
        <div style={wrap}>
            <div style={headRow}>
                <div>
                    <h1 style={h1s}>NPS &amp; Satisfaction Surveys</h1>
                    <p style={subP}>Measure customer satisfaction with shareable survey links.</p>
                </div>
                <button className="btn primary" onClick={() => app().openSurveyBuilderModal && app().openSurveyBuilderModal()}><i className="fas fa-plus"></i> New Survey</button>
            </div>
            {surveys.length === 0 ? (
                <div style={emptyBox}>
                    <i className="fas fa-star" style={{ fontSize: '48px', display: 'block', marginBottom: '12px' }}></i>
                    <h3 style={{ color: 'var(--gray-500)' }}>No surveys yet</h3>
                    <button className="btn primary" onClick={() => app().openSurveyBuilderModal && app().openSurveyBuilderModal()}>Create Survey</button>
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
                    {surveys.map((survey) => (
                        <div key={survey.id} style={card}>
                            <div style={{ ...cardHead, marginBottom: '10px' }}>
                                <div>
                                    <h3 style={{ margin: 0, fontSize: '16px' }}>{survey.name}</h3>
                                    <span style={{ fontSize: '12px', color: 'var(--gray-400)', textTransform: 'uppercase' }}>{survey.type}</span>
                                </div>
                                <span style={badge(survey.is_active)}>{survey.is_active ? 'Active' : 'Inactive'}</span>
                            </div>
                            <p style={{ color: 'var(--gray-600)', fontSize: '13px', margin: '0 0 16px' }}>{survey.question}</p>
                            <div style={actionRow}>
                                <button className="btn secondary" style={btnFlex} onClick={() => app().copySurveyLink && app().copySurveyLink(survey.id)}><i className="fas fa-copy"></i> Copy Link</button>
                                <button className="btn secondary" style={btnFlex} onClick={() => app().showSurveyResults && app().showSurveyResults(survey.id)}><i className="fas fa-chart-bar"></i> Results</button>
                                <button className="btn-icon" style={{ color: 'var(--error)' }} onClick={() => app().deleteSurvey && app().deleteSurvey(survey.id)}><i className="fas fa-trash"></i></button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Contracts ─────────────────────────────────────────────────────────────────
const CONTRACT_BADGE = {
    draft: { bg: '#f3f4f6', color: '#6b7280', label: 'Draft' },
    sent: { bg: '#dbeafe', color: '#1e40af', label: 'Sent' },
    signed: { bg: '#d1fae5', color: '#065f46', label: 'Signed' },
    declined: { bg: '#fee2e2', color: '#991b1b', label: 'Declined' },
};
function ContractStatusBadge({ status }) {
    const s = CONTRACT_BADGE[status] || CONTRACT_BADGE.draft;
    return <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '12px', background: s.bg, color: s.color }}>{s.label}</span>;
}
const th = { padding: '12px 16px', textAlign: 'left' };
const td = { padding: '12px 16px' };

export function ContractsView({ contracts = [] }) {
    window.__REACT_CONTRACTS_STATE = 'ready'; window.__REACT_CONTRACTS_ROWS = contracts.length;
    return (
        <div style={wrap}>
            <div style={headRow}>
                <div>
                    <h1 style={h1s}>Contract Management</h1>
                    <p style={subP}>Upload contracts and collect e-signatures from customers.</p>
                </div>
                <button className="btn primary" onClick={() => app().openUploadContractModal && app().openUploadContractModal()}><i className="fas fa-plus"></i> Upload Contract</button>
            </div>
            {contracts.length === 0 ? (
                <div style={emptyBox}>
                    <i className="fas fa-file-signature" style={{ fontSize: '48px', display: 'block', marginBottom: '12px' }}></i>
                    <h3 style={{ color: 'var(--gray-500)' }}>No contracts yet</h3>
                    <p>Upload a contract to send for e-signature.</p>
                    <button className="btn primary" onClick={() => app().openUploadContractModal && app().openUploadContractModal()}>Upload Contract</button>
                </div>
            ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', background: 'white', border: '1px solid var(--gray-200)', borderRadius: '12px', overflow: 'hidden' }}>
                    <thead><tr style={{ background: 'var(--gray-50)', borderBottom: '2px solid var(--gray-200)' }}>
                        <th scope="col" style={th}>Title</th>
                        <th scope="col" style={th}>Customer</th>
                        <th scope="col" style={th}>Status</th>
                        <th scope="col" style={th}>Date</th>
                        <th scope="col" style={th}>Actions</th>
                    </tr></thead>
                    <tbody>{contracts.map((c) => (
                        <tr key={c.id} style={{ borderBottom: '1px solid var(--gray-100)' }}>
                            <td style={td}><i className="fas fa-file-contract" style={{ color: 'var(--primary)', marginRight: '8px' }}></i>{c.title}</td>
                            <td style={{ ...td, color: 'var(--gray-600)' }}>{c.signer_name || (c.customer_id ? `Customer #${c.customer_id}` : '—')}</td>
                            <td style={td}><ContractStatusBadge status={c.status} /></td>
                            <td style={{ ...td, color: 'var(--gray-400)', fontSize: '13px' }}>{c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}</td>
                            <td style={td}>
                                {c.status === 'draft' && <button className="btn secondary" style={{ fontSize: '12px', padding: '4px 10px' }} onClick={() => app().sendContractForSigning && app().sendContractForSigning(c.id)}><i className="fas fa-paper-plane"></i> Send</button>}
                                {c.status === 'sent' && <button className="btn secondary" style={{ fontSize: '12px', padding: '4px 10px' }} onClick={() => app().copySigningLink && app().copySigningLink(c.id)}><i className="fas fa-copy"></i> Copy Link</button>}
                                {c.status === 'signed' && <button className="btn secondary" style={{ fontSize: '12px', padding: '4px 10px' }} onClick={() => app().showContractDetail && app().showContractDetail(c.id)}><i className="fas fa-eye"></i> View</button>}
                            </td>
                        </tr>
                    ))}</tbody>
                </table>
            )}
        </div>
    );
}
