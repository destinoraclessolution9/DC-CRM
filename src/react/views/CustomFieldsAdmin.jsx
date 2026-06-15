// React-island migration — Custom Fields admin (read-only two-column list).
//
// The chunk (showCustomFieldsAdmin in chunks/script-forms.js) fetches the
// custom_field_definitions, splits by entity_type, and passes prospectFields +
// customerFields as props. Add/delete go through modals + window.app.* (vanilla).
// React auto-escapes f.label/f.type — the legacy interpolated them UNescaped.

const app = () => window.app || {};

function FieldList({ fields }) {
    if (!fields.length) return <p style={{ color: 'var(--gray-400)', fontSize: '13px', padding: '8px 0' }}>No custom fields yet.</p>;
    return (
        <>
            {fields.map((f) => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'white', border: '1px solid var(--gray-200)', borderRadius: '8px', marginBottom: '6px' }}>
                    <div><strong style={{ fontSize: '14px' }}>{f.label}</strong><span style={{ color: 'var(--gray-400)', fontSize: '12px', marginLeft: '8px' }}>{f.type}{f.is_required ? ' · required' : ''}</span></div>
                    <button className="btn-icon" style={{ color: 'var(--error)' }} onClick={() => app().deleteCustomFieldDefinition(f.id)}><i className="fas fa-trash"></i></button>
                </div>
            ))}
        </>
    );
}

function Column({ title, entityType, fields }) {
    return (
        <div style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: '12px', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h3 style={{ margin: 0, fontSize: '16px' }}>{title}</h3>
                <button className="btn secondary" style={{ fontSize: '13px', padding: '6px 12px' }} onClick={() => app().openCustomFieldModal(entityType)}><i className="fas fa-plus"></i> Add</button>
            </div>
            <FieldList fields={fields} />
        </div>
    );
}

export function CustomFieldsAdmin({ prospectFields = [], customerFields = [] }) {
    window.__REACT_CUSTOMFIELDS_STATE = 'ready';
    window.__REACT_CUSTOMFIELDS_ROWS = prospectFields.length + customerFields.length;
    return (
        <div style={{ padding: '24px', maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ marginBottom: '24px' }}>
                <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>Custom Fields</h1>
                <p style={{ color: 'var(--gray-500)', margin: '4px 0 0' }}>Add custom data fields to prospects and customers. Fields appear in all create/edit forms.</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <Column title="Prospect Fields" entityType="prospect" fields={prospectFields} />
                <Column title="Customer Fields" entityType="customer" fields={customerFields} />
            </div>
            <div style={{ marginTop: '24px', padding: '16px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', fontSize: '13px', color: '#1e40af' }}>
                <i className="fas fa-info-circle"></i> Custom field values appear in the Basic & Info tab of each customer/prospect profile.
            </div>
        </div>
    );
}
