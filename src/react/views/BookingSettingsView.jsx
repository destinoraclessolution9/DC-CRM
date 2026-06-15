// React-island migration — Meeting Scheduler / Booking Settings (read-render).
//
// The chunk (showBookingSettingsView in chunks/script-cps.js) fetches the agent's
// booking_slots + booking_appointments and passes them as props along with the
// shareable bookingUrl. All mutations (add slot, toggle active, delete, confirm/
// cancel, share) go through window.app.* (modals + writes stay vanilla). React
// auto-escapes prospect_name / referred_by etc. (the legacy interpolated raw).

const app = () => window.app || {};
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const emptyBox = { textAlign: 'center', padding: '40px', background: 'white', border: '1px solid var(--gray-200)', borderRadius: '8px', color: 'var(--gray-400)' };

function SlotRow({ slot }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'white', border: '1px solid var(--gray-200)', borderRadius: '8px', padding: '12px 16px', marginBottom: '8px' }}>
            <div>
                <strong>{DAY_NAMES[slot.day_of_week]}</strong>
                <span style={{ color: 'var(--gray-500)', marginLeft: '8px' }}>{slot.start_time} – {slot.end_time}</span>
                <span style={{ color: 'var(--gray-400)', fontSize: '12px', marginLeft: '8px' }}>{slot.duration_minutes}min slots</span>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                    <input type="checkbox" defaultChecked={!!slot.is_active} onChange={(e) => app().toggleSlotActive(slot.id, e.target.checked)} /> Active
                </label>
                <button className="btn-icon" aria-label="Delete time slot" onClick={() => app().deleteBookingSlot(slot.id)} style={{ color: 'var(--error)' }}><i className="fas fa-trash" aria-hidden="true"></i></button>
            </div>
        </div>
    );
}

function ApptRow({ appt }) {
    const sub = [appt.prospect_occupation, appt.prospect_company].filter(Boolean).join(' · ');
    return (
        <div style={{ background: 'white', border: '1px solid var(--gray-200)', borderRadius: '8px', padding: '12px 16px', marginBottom: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <strong>{appt.prospect_name}</strong>
                    <div style={{ fontSize: '12px', color: 'var(--gray-500)' }}>{appt.booking_date} {appt.start_time} · {appt.prospect_phone || appt.prospect_email || ''}</div>
                    {appt.referred_by ? <div style={{ fontSize: '11px', color: 'var(--gray-400)', marginTop: '2px' }}><i className="fas fa-user-friends" style={{ marginRight: '3px' }}></i>Ref: {appt.referred_by}{appt.referral_relationship ? ` (${appt.referral_relationship})` : ''}</div> : null}
                    {sub ? <div style={{ fontSize: '11px', color: 'var(--gray-400)', marginTop: '2px' }}>{sub}</div> : null}
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                    {appt.status === 'pending' ? (
                        <>
                            <button className="btn primary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => app().confirmBookingAppointment(appt.id)}>Confirm</button>
                            <button className="btn secondary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => app().cancelBookingAppointment(appt.id)}>Cancel</button>
                        </>
                    ) : (
                        <span style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '20px', background: appt.status === 'confirmed' ? '#d1fae5' : '#fee2e2', color: appt.status === 'confirmed' ? '#065f46' : '#991b1b' }}>{appt.status}</span>
                    )}
                </div>
            </div>
        </div>
    );
}

export function BookingSettingsView({ slots = [], appointments = [], bookingUrl = '' }) {
    window.__REACT_BOOKING_STATE = 'ready';
    window.__REACT_BOOKING_ROWS = slots.length;
    const activeApptCount = appointments.filter((a) => a.status !== 'cancelled').length;
    return (
        <div style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                    <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>Meeting Scheduler</h1>
                    <p style={{ color: 'var(--gray-500)', margin: '4px 0 0' }}>Let prospects book appointments directly via a shareable link.</p>
                </div>
                <button className="btn primary" onClick={() => app().openAddSlotModal()}><i className="fas fa-plus"></i> Add Time Slot</button>
            </div>
            <div style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: '12px', padding: '20px', marginBottom: '24px' }}>
                <h3 style={{ margin: '0 0 8px', fontSize: '15px' }}>Your Booking Link</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <input type="text" value={bookingUrl} readOnly style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: '6px', background: 'white', fontSize: '13px' }} />
                    <button className="btn secondary" onClick={() => app().openShareBookingLinkModal()}><i className="fas fa-share-alt"></i> Share</button>
                    <a href={bookingUrl} target="_blank" rel="noopener noreferrer" className="btn secondary"><i className="fas fa-external-link-alt"></i> Preview</a>
                </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <div>
                    <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px' }}>Availability Slots</h3>
                    {slots.length === 0 ? (
                        <div style={emptyBox}><i className="fas fa-clock" style={{ fontSize: '32px', display: 'block', marginBottom: '8px' }}></i>No slots configured yet.</div>
                    ) : slots.map((s) => <SlotRow key={s.id} slot={s} />)}
                </div>
                <div>
                    <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px' }}>Appointments <span style={{ fontSize: '13px', fontWeight: 400, color: 'var(--gray-400)' }}>({activeApptCount})</span></h3>
                    {appointments.length === 0 ? (
                        <div style={emptyBox}><i className="fas fa-calendar" style={{ fontSize: '32px', display: 'block', marginBottom: '8px' }}></i>No bookings yet. Share your link to get started.</div>
                    ) : appointments.slice(0, 10).map((a) => <ApptRow key={a.id} appt={a} />)}
                </div>
            </div>
        </div>
    );
}
