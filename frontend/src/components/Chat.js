import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:3001';

export default function Chat() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [user, setUser] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    // Get user info from localStorage
    const userData = localStorage.getItem('user');
    if (userData) {
      try {
        setUser(JSON.parse(userData));
      } catch (e) {
        console.error('Error parsing user data:', e);
      }
    }
  }, []);

  const logout = async () => {
    try {
      const token = localStorage.getItem('token');
      if (token) {
        // Call logout endpoint
        await axios.post(`${API_BASE_URL}/api/logout`, {}, {
          headers: { Authorization: `Bearer ${token}` }
        });
      }
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      // Clear local storage and redirect
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      
      // Trigger token update event for App.js
      window.dispatchEvent(new Event('tokenUpdate'));
      
      navigate('/login');
    }
  };

  const isValidQuestion = (q) => {
    return q && q.trim().length >= 3 && q.trim().length <= 1000;
  };

  async function askQuestion() {
    if (!isValidQuestion(question)) {
      setError('Please enter a question (3-1000 characters)');
      return;
    }

    setLoading(true);
    setError('');
    setAnswer('');

    try {
    const token = localStorage.getItem('token');
      if (!token) {
        setError('Session expired. Please login again.');
        setTimeout(() => navigate('/login'), 2000);
        return;
      }

    const { data } = await axios.post(
        `${API_BASE_URL}/api/query`,
        { question: question.trim(), k: 5 },
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 30000 // 30 seconds timeout
        }
    );

      if (data.success) {
        setAnswer(data.answer || 'No answer found');
        
        // Add to chat history
        const newChat = {
          id: Date.now(),
          question: question.trim(),
          answer: data.answer || 'No answer found',
          timestamp: new Date().toLocaleString(),
          matches: data.matches || []
        };
        
        setChatHistory(prev => [newChat, ...prev]);
        setQuestion(''); // Clear input after successful query
      } else {
        setError(data.message || 'Failed to get answer');
      }

    } catch (error) {
      console.error('Query error:', error);
      
      if (error.response) {
        const { status, data } = error.response;
        if (status === 401) {
          setError('Session expired. Please login again.');
          setTimeout(() => {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.dispatchEvent(new Event('tokenUpdate'));
            navigate('/login');
          }, 2000);
        } else if (status === 400) {
          setError(data.message || 'Invalid question format');
        } else if (status === 429) {
          setError('Too many requests. Please wait a moment and try again.');
        } else {
          setError(data.message || 'Server error. Please try again.');
        }
      } else if (error.request) {
        setError('Cannot connect to server. Please check your internet connection.');
      } else {
        setError('An unexpected error occurred. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      askQuestion();
    }
  };

  const clearHistory = () => {
    setChatHistory([]);
    setAnswer('');
    setError('');
  };

  return (
    <div className="chat-container">
      <div className="chat-header">
        <div className="user-info">
          <h2>Legal QA Assistant</h2>
          {user && <span>Welcome, {user.username}</span>}
        </div>
        <div className="header-actions">
          <button onClick={clearHistory} className="clear-btn" title="Clear History">
            Clear History
          </button>
          <button onClick={logout} className="logout-btn">
            Logout
          </button>
        </div>
      </div>

      <div className="query-section">
      <textarea
          placeholder="Ask about your legal cases... (e.g., 'What are the key points about contract disputes?' or 'Show me cases related to property law')"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyPress={handleKeyPress}
          disabled={loading}
          maxLength={1000}
          rows={4}
        />
        
        <div className="query-actions">
          <span className="char-count">
            {question.length}/1000 characters
          </span>
          <button 
            onClick={askQuestion}
            disabled={loading || !isValidQuestion(question)}
            className={loading ? 'loading' : ''}
          >
            {loading ? (
              <>
                <span className="spinner"></span>
                Searching...
              </>
            ) : (
              'Ask Question'
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {answer && (
        <div className="current-answer">
          <h3>Answer:</h3>
          <pre className="response">{answer}</pre>
        </div>
      )}

      {chatHistory.length > 0 && (
        <div className="chat-history">
          <h3>Recent Questions:</h3>
          {chatHistory.map((chat) => (
            <div key={chat.id} className="chat-item">
              <div className="chat-question">
                <strong>Q:</strong> {chat.question}
                <span className="timestamp">{chat.timestamp}</span>
              </div>
              <div className="chat-answer">
                <strong>A:</strong>
                <pre>{chat.answer}</pre>
              </div>
              {chat.matches && chat.matches.length > 0 && (
                <div className="chat-sources">
                  <small>Sources: {chat.matches.length} relevant documents found</small>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="chat-help">
        <details>
          <summary>💡 Tips for better results</summary>
          <ul>
            <li>Be specific in your questions</li>
            <li>Use legal terminology when appropriate</li>
            <li>Ask about specific case types, laws, or legal concepts</li>
            <li>Try different phrasings if you don't get good results</li>
          </ul>
        </details>
      </div>
    </div>
  );
}
