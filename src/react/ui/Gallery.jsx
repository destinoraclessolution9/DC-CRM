// Phase 4 — living component gallery. Renders the whole src/react/ui library in
// representative states + the headline 300k-row VirtualizedDataTable on MOCK
// data (no auth, no network). Serves three jobs: (1) DX docs, (2) an auth-free
// verification surface (load /ui-gallery, screenshot, scroll the 300k table),
// (3) a visual-snapshot fixture. Built as a SEPARATE bundle (ui-gallery-entry)
// so none of this ships in the production react-island.js.
import { useState } from 'react';
import {
    Button, IconButton, Badge, ScoreBadge, Spinner, Skeleton, TextField, Textarea,
    Select, Combobox, Checkbox, Switch, Card, Avatar, Tooltip, Tabs, Menu, Pagination,
    Breadcrumb, EmptyState, ErrorState, Modal, Drawer, ConfirmDialog, SelectAgent,
    ProtectionBar, HealthBadge, RoleGate, StatCard, VirtualizedDataTable, InfiniteList,
} from './index.js';

const CITIES = ['Kuala Lumpur', 'Petaling Jaya', 'Johor Bahru', 'Penang', 'Ipoh'];
const GRADES = ['A+', 'A', 'B', 'C', 'D'];
const TOTAL = 300000;

// Mock offset pager over a virtual 300k dataset — proves windowing without a server.
function mockFetchPage({ pageParam = 0, limit = 50 }) {
    const rows = [];
    for (let i = pageParam; i < Math.min(pageParam + limit, TOTAL); i++) {
        rows.push({
            id: i + 1,
            full_name: 'Prospect #' + (i + 1).toLocaleString(),
            score: GRADES[i % GRADES.length],
            phone: '01' + String(100000000 + i),
            city: CITIES[i % CITIES.length],
            protection_days_remaining: i % 61,
        });
    }
    return Promise.resolve({ rows, count: TOTAL });
}

const COLUMNS = [
    { key: 'id', header: '#', width: 90 },
    { key: 'full_name', header: 'Name', render: (r) => <strong>{r.full_name}</strong> },
    { key: 'score', header: 'Score', render: (r) => <ScoreBadge grade={r.score} /> },
    { key: 'phone', header: 'Phone' },
    { key: 'city', header: 'City' },
];

// Mock async option loader for the Combobox (no network).
const CITY_LIST = ['Kuala Lumpur', 'Petaling Jaya', 'Johor Bahru', 'Penang', 'Ipoh', 'Melaka', 'Kota Kinabalu', 'Kuching', 'Shah Alam', 'Seremban'];
function mockLoadOptions(q, { signal } = {}) {
    const items = CITY_LIST
        .filter((c) => c.toLowerCase().includes(String(q || '').toLowerCase()))
        .map((c) => ({ value: c, label: c }));
    return new Promise((resolve) => setTimeout(() => resolve({ items }), 150));
}

function Section({ title, children }) {
    return (
        <section style={{ marginBottom: 36 }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, margin: '0 0 12px', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-soft)', paddingBottom: 6 }}>{title}</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>{children}</div>
        </section>
    );
}

export function Gallery() {
    const [modal, setModal] = useState(false);
    const [drawer, setDrawer] = useState(false);
    const [confirm, setConfirm] = useState(false);
    const [tab, setTab] = useState('a');
    const [checked, setChecked] = useState(true);
    const [on, setOn] = useState(false);
    const [agent, setAgent] = useState('2');
    const [city, setCity] = useState('');

    const agents = [{ id: 1, full_name: 'Agent Lim' }, { id: 2, full_name: 'Agent Tan' }, { id: 3, full_name: 'Agent Wong' }];
    const agentNames = { 1: 'Agent Lim', 2: 'Agent Tan', 3: 'Agent Wong' };

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px 80px' }}>
            <header style={{ marginBottom: 28 }}>
                <h1 style={{ fontFamily: 'var(--font-display)', margin: 0, color: 'var(--text-primary)' }}>悅客匯 CRM — UI System Gallery</h1>
                <p style={{ color: 'var(--text-secondary)', margin: '6px 0 0' }}>Phase 2–4 React component library on the shared design tokens. Toggle <code>[data-theme]</code> to preview dark mode.</p>
                <div style={{ marginTop: 12 }}>
                    <Button variant="secondary" size="sm" onClick={() => {
                        const r = document.documentElement;
                        r.setAttribute('data-theme', r.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
                    }}>Toggle light / dark</Button>
                </div>
            </header>

            <Section title="Buttons">
                <Button variant="primary">Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="danger">Danger</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="link">Link</Button>
                <Button variant="primary" loading>Saving…</Button>
                <Button variant="secondary" disabled>Disabled</Button>
                <Button variant="primary" size="sm">Small</Button>
                <Button variant="primary" size="lg">Large</Button>
                <IconButton icon="fas fa-pen" aria-label="Edit" />
                <IconButton icon="fas fa-trash" aria-label="Delete" variant="danger" />
            </Section>

            <Section title="Badges & status">
                <Badge tone="neutral">Neutral</Badge>
                <Badge tone="info">Info</Badge>
                <Badge tone="success">Success</Badge>
                <Badge tone="warning">Warning</Badge>
                <Badge tone="danger">Danger</Badge>
                <Badge tone="info" removable onRemove={() => {}}>Removable</Badge>
                <ScoreBadge grade="A+" /><ScoreBadge grade="A" /><ScoreBadge grade="B" /><ScoreBadge grade="C" /><ScoreBadge grade="D" />
                <Spinner label="Loading" />
            </Section>

            <Section title="Stat cards">
                <StatCard label="Prospects" value="300,000" icon="fas fa-users" trend={{ dir: 'up', text: '+4.2%' }} tone="info" />
                <StatCard label="Customers" value="5,128" icon="fas fa-user-check" trend={{ dir: 'up', text: '+1.1%' }} tone="success" />
                <StatCard label="Dormant" value="812" icon="fas fa-moon" trend={{ dir: 'down', text: '-9%' }} tone="warning" />
            </Section>

            <Section title="Form controls">
                <div style={{ minWidth: 240 }}><TextField label="Full name" placeholder="Jane Tan" hint="As on IC" /></div>
                <div style={{ minWidth: 240 }}><TextField label="Email" type="email" error="Enter a valid email" defaultValue="bad@" required /></div>
                <div style={{ minWidth: 240 }}><Select label="Ming Gua" placeholder="Choose…" options={[{ value: '1', label: 'Kan' }, { value: '2', label: 'Kun' }]} /></div>
                <div style={{ minWidth: 240 }}><Textarea label="Notes" rows={3} placeholder="Meeting notes…" /></div>
                <Checkbox label="Subscribed" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                <Switch label="Auto follow-up" checked={on} onChange={(v) => setOn(typeof v === 'boolean' ? v : v?.target?.checked)} />
                <div style={{ minWidth: 220 }}><SelectAgent value={agent} onChange={setAgent} agents={agents} agentNames={agentNames} canReassign /></div>
                <div style={{ minWidth: 260 }}><Combobox label="City (async search)" value={city} onChange={setCity} loadOptions={mockLoadOptions} placeholder="Type to search…" /></div>
            </Section>

            <Section title="Overlays & navigation">
                <Button onClick={() => setModal(true)}>Open modal</Button>
                <Button onClick={() => setDrawer(true)}>Open drawer</Button>
                <Button variant="danger" onClick={() => setConfirm(true)}>Delete…</Button>
                <Menu trigger={<Button variant="secondary">Menu ▾</Button>} items={[
                    { label: 'Edit', icon: 'fas fa-pen', onSelect: () => {} },
                    { label: 'Duplicate', icon: 'fas fa-copy', onSelect: () => {} },
                    { label: 'Delete', icon: 'fas fa-trash', danger: true, onSelect: () => {} },
                ]} />
                <Tooltip content="Helpful hint"><Button variant="ghost">Hover me</Button></Tooltip>
                <Breadcrumb items={[{ label: 'Home', onClick: () => {} }, { label: 'Prospects', onClick: () => {} }, { label: 'Detail' }]} />
            </Section>

            <Section title="Tabs">
                <div style={{ width: '100%' }}>
                    <Tabs value={tab} onChange={setTab} tabs={[
                        { id: 'a', label: 'Overview', content: <p style={{ color: 'var(--text-secondary)' }}>Overview panel.</p> },
                        { id: 'b', label: 'Activity', content: <p style={{ color: 'var(--text-secondary)' }}>Activity panel.</p> },
                        { id: 'c', label: 'Notes', content: <p style={{ color: 'var(--text-secondary)' }}>Notes panel.</p> },
                    ]} />
                </div>
            </Section>

            <Section title="Cards, avatars, protection">
                <Card header={<strong>Customer card</strong>} footer={<small style={{ color: 'var(--text-muted)' }}>Updated today</small>} padding={16}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <Avatar name="Jane Tan" size="lg" />
                        <div><div style={{ fontWeight: 600 }}>Jane Tan</div><div style={{ color: 'var(--text-muted)', fontSize: 13 }}>RM 128,000 LTV</div></div>
                    </div>
                </Card>
                <Card padding={16} style={{ minWidth: 240 }}>
                    <div style={{ fontSize: 13, marginBottom: 8, color: 'var(--text-secondary)' }}>Protection window</div>
                    <ProtectionBar prospect={{ protection_days_remaining: 41 }} />
                    <div style={{ marginTop: 10 }}><ProtectionBar prospect={{ protection_days_remaining: 9 }} /></div>
                    <div style={{ marginTop: 10 }}><ProtectionBar prospect={{ protection_days_remaining: 2 }} /></div>
                </Card>
            </Section>

            <Section title="States">
                <Card padding={0} style={{ minWidth: 300 }}><EmptyState title="No prospects yet" description="Add your first prospect to get started." action={<Button variant="primary" size="sm">Add prospect</Button>} /></Card>
                <Card padding={0} style={{ minWidth: 300 }}><ErrorState title="Couldn't load" description="Server temporarily unavailable." onRetry={() => {}} /></Card>
                <Card padding={16} style={{ minWidth: 260 }}><Skeleton rows={4} /></Card>
            </Section>

            <Section title="InfiniteList (mock 300k)">
                <div style={{ width: '100%', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-md)' }}>
                    <InfiniteList
                        queryKey={['gallery-list']}
                        fetchPage={mockFetchPage}
                        height={220}
                        itemHeight={52}
                        ariaLabel="Mock prospects list"
                        renderItem={(r) => (
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid var(--border-soft)' }}>
                                <span><strong>{r.full_name}</strong> · {r.city}</span>
                                <ScoreBadge grade={r.score} />
                            </div>
                        )}
                    />
                </div>
            </Section>

            <Section title="VirtualizedDataTable — 300,000 rows, server-paged, windowed">
                <div style={{ width: '100%' }}>
                    <VirtualizedDataTable
                        columns={COLUMNS}
                        queryKey={['gallery-vdt']}
                        fetchPage={mockFetchPage}
                        height={420}
                        rowHeight={44}
                        ariaLabel="Mock 300k prospects"
                        onRowClick={() => {}}
                    />
                </div>
            </Section>

            <RoleGate level={99} userLevel={1}>
                <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>RoleGate: visible because userLevel(1) ≤ level(99). <HealthBadge entity={{}} /></p>
            </RoleGate>

            <Modal open={modal} onClose={() => setModal(false)} title="Edit prospect" description="Update the prospect's details." footer={<><Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button><Button variant="primary" onClick={() => setModal(false)}>Save</Button></>}>
                <TextField label="Name" defaultValue="Jane Tan" />
            </Modal>
            <Drawer open={drawer} onClose={() => setDrawer(false)} title="Filters" side="right">
                <div style={{ padding: 16 }}><Select label="City" options={CITIES.map((c) => ({ value: c, label: c }))} /></div>
            </Drawer>
            <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Delete prospect?" message="This cannot be undone." tone="danger" onConfirm={() => {}} />
        </div>
    );
}
