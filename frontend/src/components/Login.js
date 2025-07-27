import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:3001';

export default function Login() {
  const [form, setForm] = useState({ username: '', password: '' });
  const [isNew, setIsNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();

  const validateForm = () => {
    if (!form.username.trim()) {
      setError('Username is required');
      return false;
    }
    if (form.username.length < 3) {
      setError('Username must be at least 3 characters long');
      return false;
    }
    if (!form.password) {
      setError('Password is required');
      return false;
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters long');
      return false;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(form.username)) {
      setError('Username can only contain letters, numbers, underscores, and hyphens');
      return false;
    }
    return true;
  };

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      const endpoint = isNew ? '/api/signup' : '/api/login';
      const url = `${API_BASE_URL}${endpoint}`;
      
      const { data } = await axios.post(url, form, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (data.success) {
        if (data.token) {
          // Store token and user info
      localStorage.setItem('token', data.token);
          if (data.user) {
            localStorage.setItem('user', JSON.stringify(data.user));
          }
          
          // Trigger token update event for App.js
          window.dispatchEvent(new Event('tokenUpdate'));
          
          setSuccess(data.message || `${isNew ? 'Signup' : 'Login'} successful!`);
          
          // Navigate to chat page immediately
          navigate('/chat');
        } else {
          setError('Authentication failed. Please try again.');
        }
      } else {
        setError(data.message || 'Authentication failed');
      }

    } catch (error) {
      console.error('Auth error:', error);
      
      if (error.response) {
        // Server responded with error status
        const { data, status } = error.response;
        if (status === 409) {
          setError('Username already exists. Please choose a different username.');
        } else if (status === 401) {
          setError('Invalid username or password.');
        } else if (status === 400) {
          setError(data.message || 'Please check your input and try again.');
        } else if (status === 429) {
          setError('Too many attempts. Please wait a few minutes and try again.');
        } else {
          setError(data.message || 'Server error. Please try again later.');
        }
      } else if (error.request) {
        // Network error
        setError('Cannot connect to server. Please check your internet connection.');
      } else {
        setError('An unexpected error occurred. Please try again.');
    }
    } finally {
      setLoading(false);
    }
  }

  const handleInputChange = (field, value) => {
    setForm({ ...form, [field]: value });
    // Clear errors when user starts typing
    if (error) setError('');
    if (success) setSuccess('');
  };

  const toggleMode = () => {
    setIsNew(!isNew);
    setError('');
    setSuccess('');
    setForm({ username: '', password: '' });
  };

  return (
    <div className="login-container">
      <h2>{isNew ? 'Create Account' : 'Sign In'}</h2>
      
      {error && (
        <div className="error-message">
          {error}
        </div>
      )}
      
      {success && (
        <div className="success-message">
          {success}
        </div>
      )}

      <form onSubmit={submit}>
        <input
          type="text"
          placeholder="Username (3-30 characters, letters, numbers, _, -)"
          value={form.username}
          onChange={e => handleInputChange('username', e.target.value)}
          disabled={loading}
          maxLength={30}
          required
        />
        <input
          type="password"
          placeholder="Password (minimum 6 characters)"
          value={form.password}
          onChange={e => handleInputChange('password', e.target.value)}
          disabled={loading}
          minLength={6}
          required
        />
        <button 
          type="submit" 
          disabled={loading || !form.username.trim() || !form.password}
          className={loading ? 'loading' : ''}
        >
          {loading ? (
            <>
              <span className="spinner"></span>
              {isNew ? 'Creating Account...' : 'Signing In...'}
            </>
          ) : (
            isNew ? 'Create Account' : 'Sign In'
          )}
        </button>
      </form>
      
      <p onClick={toggleMode} className="toggle">
        {isNew 
          ? 'Already have an account? Sign In' 
          : 'Need an account? Create Account'
        }
      </p>

      <div className="login-info">
        <p>Legal QA System</p>
        <small>Secure access to legal document search</small>
      </div>
    </div>
  );
}
