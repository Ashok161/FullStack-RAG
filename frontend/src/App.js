import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import Chat from './components/Chat';

export default function App() {
  const [token, setToken] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for token on app load
    const storedToken = localStorage.getItem('token');
    setToken(storedToken);
    setIsLoading(false);

    // Listen for storage changes (when token is set/removed)
    const handleStorageChange = () => {
      const newToken = localStorage.getItem('token');
      setToken(newToken);
    };

    // Listen for custom events when token changes
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('tokenUpdate', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('tokenUpdate', handleStorageChange);
    };
  }, []);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={token ? <Navigate to="/chat" replace /> : <Login />} />
        <Route path="/chat" element={token ? <Chat /> : <Navigate to="/login" replace />} />
        <Route path="/" element={<Navigate to={token ? "/chat" : "/login"} replace />} />
      </Routes>
    </BrowserRouter>
  );
}