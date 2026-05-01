import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LandingPage from './LandingPage';
import EditorPage from './EditorPage';
import PreviewPage from './PreviewPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Landing page */}
        <Route path="/" element={<LandingPage />} />
        
        {/* Editor routes */}
        <Route path="/edit" element={<EditorPage />} />
        <Route path="/edit/:repo" element={<EditorPage />} />
        <Route path="/edit/:owner/:repo" element={<EditorPage />} />
        <Route path="/edit/:owner/:repo/:branch" element={<EditorPage />} />
        <Route path="/edit/:owner/:repo/:branch/:commit" element={<EditorPage />} />
        
        {/* Clean preview routes (no /edit prefix) */}
        <Route path="/:repo" element={<PreviewPage />} />
        <Route path="/:owner/:repo" element={<PreviewPage />} />
        <Route path="/:owner/:repo/:branch" element={<PreviewPage />} />
        <Route path="/:owner/:repo/:branch/:commit" element={<PreviewPage />} />
        <Route path="/:owner/:repo/:branch/:commit/" element={<PreviewPage />} />
      </Routes>
    </BrowserRouter>
  );
}
