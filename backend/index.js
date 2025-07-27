// backend/index.js
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { ChromaClient } from 'chromadb';
import axios from 'axios';

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

// ChromaDB setup
const chroma = new ChromaClient({
  path: `http://${process.env.CHROMA_HOST || 'localhost'}:${process.env.CHROMA_PORT || 8000}`
});

let collection;

// Generate embeddings using Gemini API (same as preprocessing)
async function generateEmbedding(text) {
  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('your-actual-gemini-api-key-here')) {
      throw new Error('Valid GEMINI_API_KEY is required');
    }

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${GEMINI_API_KEY}`,
      {
        model: "models/embedding-001",
        content: {
          parts: [{ text: text }]
        }
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      }
    );
    
    return response.data.embedding.values;
  } catch (error) {
    console.error('❌ Embedding generation failed:', error.message);
    throw error;
  }
}

// Initialize ChromaDB
async function initChroma() {
  try {
    // Get the collection (created by preprocessing with manual embeddings)
    try {
      collection = await chroma.getCollection({
        name: process.env.CHROMA_COLLECTION || 'legal_cases'
      });
      console.log('✅ ChromaDB connected to existing collection');
    } catch (getError) {
      console.log('Collection not found, creating new one...');
      // If collection doesn't exist, create it (will be populated by preprocessing)
      collection = await chroma.createCollection({
        name: process.env.CHROMA_COLLECTION || 'legal_cases'
      });
      console.log('✅ ChromaDB collection created (will be populated by preprocessing)');
    }
    
    // Test the collection
    const count = await collection.count();
    console.log(`📊 Collection contains ${count} documents`);
    
    // Test that we can actually query with manual embeddings
    if (count > 0) {
      try {
        // Generate a test embedding and query manually
        const testEmbedding = await generateEmbedding("legal case");
        await collection.query({
          queryEmbeddings: [testEmbedding], // Use manual embeddings for query
          nResults: 1,
          include: ['documents']
        });
        console.log('✅ ChromaDB query test successful with manual embeddings');
      } catch (queryError) {
        console.log('❌ ChromaDB query test failed:', queryError.message);
        console.log('💡 Run preprocessing to populate collection with manual embeddings');
      }
    }
    
  } catch (error) {
    console.error('❌ ChromaDB failed:', error.message);
    console.log('💡 Make sure ChromaDB is running and preprocessing has been completed');
  }
}

// Auth middleware
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'No token' });
  
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

// Signup
app.post('/api/signup', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password required' });
    }
    
    if (username.length < 3) {
      return res.status(400).json({ success: false, message: 'Username must be at least 3 characters' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }
    
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'Username already exists' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hashedPassword });
    
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '24h' });
    
    res.json({ 
      success: true, 
      token, 
      user: { username },
      message: 'Account created successfully'
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ success: false, message: 'Server error during signup' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password required' });
    }
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }
    
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }
    
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '24h' });
    
    res.json({ 
      success: true, 
      token, 
      user: { username },
      message: 'Login successful'
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error during login' });
  }
});

// Generate answer using Gemini (keep this for answer generation)
async function generateAnswer(context, question) {
  try {
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes('your-actual-gemini-api-key-here')) {
      // Fallback when Gemini API is not available
      return `Based on the legal documents found:\n\n${context}\n\nRelevant information for: "${question}"`;
    }

    // Create a comprehensive prompt for Gemini to generate intelligent answers
    const prompt = `You are a helpful legal AI assistant. Based on the provided legal document excerpts, answer the user's question in a clear, informative, and conversational manner.

INSTRUCTIONS:
- Use the document context to provide accurate information
- Write in a clear, professional but conversational tone
- Focus on directly answering the user's specific question
- If the documents contain relevant case details, summarize them helpfully
- If information is limited, acknowledge what you can and cannot determine from the documents
- Do not make up information not found in the documents

USER QUESTION: ${question}

LEGAL DOCUMENT CONTEXT:
${context}

Please provide a helpful answer based on the above context:`;

    // Try with multiple Gemini model endpoints for better reliability
    const modelEndpoints = [
      'gemini-1.5-flash-latest',
      'gemini-1.5-flash',
      'gemini-pro'
    ];

    for (let i = 0; i < modelEndpoints.length; i++) {
      try {
        console.log(`🤖 Trying Gemini model: ${modelEndpoints[i]}`);
        
        const response = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelEndpoints[i]}:generateContent?key=${process.env.GEMINI_API_KEY}`,
          {
            contents: [{
              parts: [{
                text: prompt
              }]
            }],
            generationConfig: {
              temperature: 0.7,
              topK: 40,
              topP: 0.8,
              maxOutputTokens: 1024,
            }
          },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 20000 // Increased timeout
          }
        );
        
        if (response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
          const answer = response.data.candidates[0].content.parts[0].text.trim();
          console.log(`✅ Generated answer with ${modelEndpoints[i]}`);
          return answer;
        } else {
          throw new Error('Invalid response format from Gemini API');
        }
        
      } catch (modelError) {
        console.log(`⚠️  ${modelEndpoints[i]} failed: ${modelError.message}`);
        
        // If it's the last model, throw the error
        if (i === modelEndpoints.length - 1) {
          throw modelError;
        }
        
        // Wait a bit before trying next model
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
  } catch (error) {
    console.error('Answer generation error:', error.message);
    
    // Enhanced fallback with intelligent response
    if (error.response?.status === 503) {
      console.log('🔄 Gemini API temporarily unavailable, providing structured fallback');
      return generateStructuredFallback(context, question);
    } else if (error.response?.status === 429) {
      console.log('⏱️  Rate limit exceeded, waiting and providing fallback');
      return generateStructuredFallback(context, question);
    } else {
      console.log('🛠️  Using enhanced fallback due to API error');
      return generateStructuredFallback(context, question);
    }
  }
}

// Generate a structured fallback answer when Gemini API is unavailable
function generateStructuredFallback(context, question) {
  try {
    // Extract key information from context
    const documents = context.split('[Document').filter(doc => doc.trim());
    const relevantInfo = [];
    
    documents.forEach((doc, index) => {
      if (index === 0) return; // Skip empty first element
      
      // Extract document title
      const titleMatch = doc.match(/(\d+): ([^\]]+)\]/);
      const title = titleMatch ? titleMatch[2] : `Document ${index}`;
      
      // Extract first meaningful sentence or key information
      const content = doc.split('---')[0].trim();
      const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);
      const keySentence = sentences[0] || content.substring(0, 150);
      
      relevantInfo.push({
        title: title.trim(),
        content: keySentence.trim()
      });
    });
    
    // Create structured response
    let structuredAnswer = `Based on the legal documents, here's what I found regarding "${question}":\n\n`;
    
    relevantInfo.forEach((info, index) => {
      structuredAnswer += `📄 **${info.title}**\n`;
      structuredAnswer += `${info.content}\n\n`;
    });
    
    structuredAnswer += `---\n💡 This information is extracted directly from ${relevantInfo.length} relevant legal document(s). `;
    structuredAnswer += `For more detailed analysis, please ensure the AI service is available.`;
    
    return structuredAnswer;
    
  } catch (fallbackError) {
    console.error('Fallback generation error:', fallbackError.message);
    return `Based on the legal documents found:\n\n${context}\n\n---\n\nRelevant information for: "${question}"`;
  }
}

// Query endpoint to search legal documents
app.post('/api/query', auth, async (req, res) => {
  try {
    const { question } = req.body;
    
    if (!question || typeof question !== 'string' || question.trim().length < 3) {
      return res.status(400).json({ 
        success: false, 
        message: 'Question must be at least 3 characters long' 
      });
    }
    
    console.log(`🔍 Searching for: "${question}"`);
    
    // Generate embedding for the question using Gemini API (same as preprocessing)
    const queryEmbedding = await generateEmbedding(question);
    
    // Use ChromaDB's query with manual embeddings
    const results = await collection.query({
      queryEmbeddings: [queryEmbedding], // Use manual embeddings instead of queryTexts
      nResults: 5,
      include: ['documents', 'metadatas', 'distances']
    });
    
    console.log(`📊 Found ${results.documents[0]?.length || 0} matches`);
    
    if (!results.documents[0] || results.documents[0].length === 0) {
      return res.json({
        success: true,
        answer: "I couldn't find any relevant documents for your question. Please try rephrasing your query or ask about different legal topics.",
        matches: 0
      });
    }
    
    const documents = results.documents[0];
    const metadatas = results.metadatas[0];
    const distances = results.distances[0];
    
    // Filter for good matches (distance < 1.5 is a good similarity threshold)
    const goodMatches = documents.filter((_, i) => distances[i] < 1.5);
    
    if (goodMatches.length === 0) {
      return res.json({
        success: true,
        answer: "I found some documents, but they don't seem closely related to your question. Please try rephrasing your query or ask about different legal topics.",
        matches: 0
      });
    }
    
    // Create context from relevant documents with better formatting
    const context = goodMatches.slice(0, 5).map((doc, i) => {
      const metadata = metadatas[documents.indexOf(doc)];
      return `[Document ${i + 1}: ${metadata.title}]
${doc.substring(0, 800)}${doc.length > 800 ? '...' : ''}
---`;
    }).join('\n');
    
    console.log(`📄 Using ${goodMatches.length} relevant documents for context`);
    
    // Generate intelligent answer using the context
    const answer = await generateAnswer(context, question);
    
    res.json({
      success: true,
      answer,
      matches: goodMatches.length
    });
    
  } catch (error) {
    console.error('Query error:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to process query. Please try again.' 
    });
  }
});

// Logout endpoint
app.post('/api/logout', auth, (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    let chromaStatus = 'disconnected';
    let documentCount = 0;
    
    if (collection) {
      try {
        documentCount = await collection.count();
        chromaStatus = 'connected';
      } catch (e) {
        chromaStatus = 'error';
      }
    }
    
    res.json({ 
      success: true, 
      message: 'Server is running',
      status: {
        database: dbStatus,
        vectorDB: chromaStatus,
        documents: documentCount
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Health check failed' });
  }
});

// Start server
async function startServer() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected');
    
    await initChroma();
    
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`�� Health check: http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    console.error('❌ Server startup failed:', error);
    process.exit(1);
  }
}

startServer();
