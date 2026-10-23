import { useEffect, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Camera, LockKey, MapPin, MagnifyingGlass, Question, Sparkle, Trash, X } from '@phosphor-icons/react';

type Memory = {
  id: string;
  name: string;
  location: string;
  note: string;
  created_at: string;
  photo_url?: string | null;
};

type FindResult = { memory: Memory | null; note?: string };

function App() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Memory | null>(null);
  const [findNote, setFindNote] = useState('');
  const [busy, setBusy] = useState<'save' | 'find' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [connected, setConnected] = useState<boolean | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void refresh();
    const check = () => void fetch('/api/health').then(r => r.json()).then(data => setConnected(Boolean(data.ok && data.model_available))).catch(() => setConnected(false));
    check();
    const timer = window.setInterval(check, 12000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!photo) { setPhotoPreview(''); return; }
    const url = URL.createObjectURL(photo); setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  async function refresh() {
    try {
      const response = await fetch('/api/memories');
      if (response.ok) setMemories(await response.json());
    } catch { /* The API status is shown in the header. */ }
  }

  async function remember(event: React.FormEvent) {
    event.preventDefault(); setError(''); setMessage('');
    if (!note.trim()) { setError('Add a short note about what it is and where you put it.'); return; }
    setBusy('save');
    try {
      let image: string | undefined;
      if (photo) image = await compressPhoto(photo);
      const response = await fetch('/api/memories', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim(), image }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Could not save that memory.');
      setMemories(current => [data, ...current]); setNote(''); setPhoto(null);
      setMessage(`Got it. I’ll remember where the ${data.name.toLowerCase()} is.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not reach the local assistant.');
    } finally { setBusy(null); }
  }

  async function findItem(event: React.FormEvent) {
    event.preventDefault(); setError(''); setFindNote(''); setFound(null);
    if (!query.trim()) return;
    setBusy('find');
    try {
      const response = await fetch('/api/find', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      });
      const data: FindResult & { detail?: string } = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Could not search your memories.');
      setFound(data.memory); setFindNote(data.note || (data.memory ? 'Found in your home memory.' : 'No match yet. Try another name or detail.'));
    } catch (reason) {
      setFindNote(reason instanceof Error ? reason.message : 'Could not reach the local assistant.');
    } finally { setBusy(null); }
  }

  async function removeMemory(id: string) {
    const response = await fetch(`/api/memories/${id}`, { method: 'DELETE' });
    if (response.ok) { setMemories(current => current.filter(memory => memory.id !== id)); if (found?.id === id) setFound(null); }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Stow home"><span className="brand-mark">s</span><span>stow</span></a>
        <div className="topbar-right">
          <div className={`privacy-label ${connected ? 'is-connected' : ''}`}><LockKey size={13} weight="regular" /><span>{connected ? 'PRIVATE · ON YOUR NETWORK' : 'LOCAL MEMORY'}</span></div>
          <button className="icon-button help-button" aria-label="About Stow" onClick={() => setMenuOpen(!menuOpen)}><Question size={18} weight="regular" /></button>
          {menuOpen && <div className="help-popover"><strong>Your home, your memory.</strong><p>Photos and locations go to the Stow service on your own computer. Nothing is sent to a hosted AI service.</p>{connected === false && <p className="setup-tip">Start Ollama and run <code>ollama pull gemma3:4b</code>.</p>}<button onClick={() => setMenuOpen(false)}>Got it</button></div>}
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span className="eyebrow-line" />A SMALL MEMORY FOR YOUR HOME</p>
          <h1>Put it away.<br /><span>Find it later.</span></h1>
          <p className="hero-lede">Tell Stow where something went. Ask when you need it. No more opening every drawer.</p>
        </div>
        <div className="hero-aside" aria-hidden="true">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="aside-pin"><MapPin size={20} weight="regular" /></div>
          <span className="aside-note aside-note-top">the good scissors</span>
          <span className="aside-note aside-note-bottom">top kitchen drawer</span>
          <span className="aside-connector" />
        </div>
      </section>

      <section className="workbench" aria-label="Stow home memory">
        <div className="capture-column">
          <div className="section-heading"><span className="section-index">01</span><div><h2>Save a little memory</h2><p>What is it, and where did you put it?</p></div></div>
          <form className="capture-card" onSubmit={remember}>
            <label className="field-label" htmlFor="memory-note">SAY IT YOUR WAY</label>
            <textarea id="memory-note" value={note} onChange={event => setNote(event.target.value)} placeholder={'“I put the spare charger in the blue desk drawer, under the notebooks.”'} rows={4} />
            <div className="capture-bottom">
              <div className="photo-control">
                <button type="button" className={`photo-button ${photo ? 'has-photo' : ''}`} onClick={() => fileRef.current?.click()}>
                  {photoPreview ? <img src={photoPreview} alt="Selected item" /> : <span className="camera-icon"><Camera size={16} weight="regular" /></span>}
                  <span>{photo ? 'Photo attached' : 'Add a photo'}</span>
                </button>
                {photo && <button type="button" className="remove-photo" aria-label="Remove photo" onClick={() => setPhoto(null)}><X size={13} weight="regular" /></button>}
              </div>
              <input ref={fileRef} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={event => setPhoto(event.target.files?.[0] || null)} />
              <span className="photo-hint">Optional, helps you recognize it</span>
            </div>
            <div className="form-divider" />
            <div className="submit-row"><span className="model-caption"><Sparkle size={13} weight="regular" /> Local AI sorts the details</span><button className="primary-button" disabled={busy === 'save'}>{busy === 'save' ? 'Saving…' : <>Remember this <ArrowUpRight size={16} weight="regular" /></>}</button></div>
            {(message || error) && <p className={`inline-feedback ${error ? 'feedback-error' : 'feedback-success'}`} role="status">{error || message}</p>}
          </form>
          <div className="privacy-footnote"><LockKey size={12} weight="regular" /><span>Your notes stay on your own computer.</span></div>
        </div>

        <div className="find-column">
          <div className="section-heading"><span className="section-index">02</span><div><h2>Ask for it later</h2><p>Search like you’d ask someone at home.</p></div></div>
          <form className="search-box" onSubmit={findItem}>
            <MagnifyingGlass size={18} weight="regular" />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Where’s the thing for the monitor?" aria-label="Search your home memories" />
            <button aria-label="Search" disabled={busy === 'find'}>{busy === 'find' ? <span className="loader" /> : <ArrowUpRight size={18} weight="regular" />}</button>
          </form>
          <div className={`answer-area ${found ? 'has-answer' : ''}`} aria-live="polite">
            {found ? <div className="answer-card">
              <div className="answer-top"><span className="answer-kicker"><span className="answer-dot" /> FOUND IN YOUR HOME</span><button className="icon-button answer-menu" aria-label="Dismiss result" onClick={() => { setFound(null); setFindNote(''); }}><X size={16} weight="regular" /></button></div>
              <h3>{found.name}</h3>
              <div className="location-row"><MapPin size={17} weight="regular" /><p>{found.location}</p></div>
              {found.note && <p className="answer-detail">{found.note}</p>}
              {found.photo_url && <img className="found-photo" src={found.photo_url} alt={found.name} />}
              <span className="answer-source">From a memory you saved</span>
            </div> : <div className="answer-empty"><div className="empty-glyph"><ArrowDownLeft size={19} weight="regular" /></div><p>{findNote || 'Your answer will show up here.'}</p></div>}
          </div>
          <div className="recent-head"><div><span className="section-index">03</span><h2>Your home memory</h2></div><span className="memory-count">{memories.length} {memories.length === 1 ? 'MEMORY' : 'MEMORIES'}</span></div>
          {memories.length ? <ul className="memory-list">{memories.slice(0, 5).map(memory => <li key={memory.id} className="memory-row">
            <span className="memory-thumb">{memory.photo_url ? <img src={memory.photo_url} alt="" /> : <span>{memory.name.slice(0, 1).toUpperCase()}</span>}</span>
            <div className="memory-text"><strong>{memory.name}</strong><span>{memory.location}</span></div>
            <button className="icon-button delete-memory" aria-label={`Remove ${memory.name}`} onClick={() => void removeMemory(memory.id)}><Trash size={15} weight="regular" /></button>
          </li>)}</ul> : <div className="memory-empty"><span>No memories saved yet.</span><button type="button" onClick={() => setNote('I put the spare house key in the ceramic bowl by the front door.')}>Try a sample note <ArrowUpRight size={13} weight="regular" /></button></div>}
        </div>
      </section>

      <footer className="page-footer"><span>Less searching. More living.</span><span>LOCAL MODEL <i /> PRIVATE BY DEFAULT</span></footer>
    </main>
  );
}

async function compressPhoto(file: File): Promise<string> {
  const image = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.78).split(',')[1];
}

export default App;
