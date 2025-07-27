// backend/preprocess.js - Optimized for 400+ PDFs
import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import dotenv from 'dotenv';
import { ChromaClient } from 'chromadb';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import axios from 'axios';

dotenv.config();

console.log('🚀 Starting PDF preprocessing for 5 documents with manual embeddings...');

const CHROMA_URL = process.env.CHROMA_HOST || 'localhost';
const CHROMA_PORT = process.env.CHROMA_PORT || 8000;
const COLLECTION_NAME = process.env.CHROMA_COLLECTION || 'legal_cases';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Configuration for small batch processing (5 PDFs only)
const BATCH_SIZE = 2; // Process 2 PDFs at a time
const CHUNK_BATCH_SIZE = 10; // Add 10 chunks at a time to ChromaDB
const MAX_RETRIES = 3;
const MAX_PDFS = 5; // Only process first 5 PDFs

// Simple tracking
let processedCount = 0;
let errorLog = [];
let successLog = [];

// Initialize ChromaDB client
const chroma = new ChromaClient({
  path: `http://${CHROMA_URL}:${CHROMA_PORT}`
});

let collection;

// Clean metadata for ChromaDB
function cleanMetadata(metadata) {
  const cleaned = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== null && value !== undefined) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        cleaned[key] = value;
      } else {
        cleaned[key] = String(value);
      }
    }
  }
  return cleaned;
}

// Generate embeddings using Gemini API (manual approach)
async function generateEmbedding(text, retries = 0) {
  try {
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('your-actual-gemini-api-key-here')) {
      throw new Error('Valid GEMINI_API_KEY is required for manual embeddings');
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
    if (retries < MAX_RETRIES) {
      console.log(`   ⚠️ Embedding retry ${retries + 1}/${MAX_RETRIES} for text: ${text.substring(0, 50)}...`);
      await sleep(1000 * (retries + 1)); // Exponential backoff
      return generateEmbedding(text, retries + 1);
    }
    console.error(`   ❌ Embedding generation failed: ${error.message}`);
    throw error;
  }
}

// Sleep utility for rate limiting
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Initialize ChromaDB collection
async function initializeCollection() {
  try {
    console.log('📡 Connecting to ChromaDB...');
    
    // Always start fresh - delete existing collection if it exists
    try {
      await chroma.deleteCollection({ name: COLLECTION_NAME });
      console.log('🗑️ Deleted existing collection for fresh start');
    } catch (e) {
      console.log('ℹ️ No existing collection found');
    }
    
    // Create new collection (ChromaDB will use default embedding automatically)
    console.log(`✨ Creating collection: ${COLLECTION_NAME} with default embedding function`);
    
    collection = await chroma.createCollection({ 
      name: COLLECTION_NAME
    });
    
    console.log('✅ ChromaDB collection ready with local embeddings!');
    return collection;
  } catch (error) {
    console.error('❌ FATAL ERROR during ChromaDB initialization:', error.message);
    throw error;
  }
}

// Process a single PDF with error handling
async function processPDF(filePath, fileName, index, total) {
  try {
    console.log(`📖 Processing (${index + 1}/${total}): ${fileName}`);
    
    // Read and parse PDF
    const buffer = fs.readFileSync(filePath);
    const { text } = await pdfParse(buffer);
    
    if (!text || text.trim().length < 100) {
      throw new Error('No significant text found in PDF');
    }
    
    console.log(`  📄 Extracted ${text.length} characters`);
    
    // Split text into chunks
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200
    });
    
    const docs = await splitter.createDocuments([text], [{
      filename: fileName,
      source: fileName,
      title: fileName.replace('.PDF', '').replace(/_/g, ' ')
    }]);
    
    console.log(`  🔪 Split into ${docs.length} chunks`);
    
    if (docs.length === 0) {
      throw new Error('No chunks created from PDF');
    }
    
    // Process chunks in batches to avoid memory issues
    let totalAdded = 0;
    for (let i = 0; i < docs.length; i += CHUNK_BATCH_SIZE) {
      const chunkBatch = docs.slice(i, i + CHUNK_BATCH_SIZE);
      const batchAdded = await processChunkBatch(chunkBatch, fileName, i);
      totalAdded += batchAdded;
      
      // Small delay between chunk batches
      if (i + CHUNK_BATCH_SIZE < docs.length) {
        await sleep(100);
      }
    }
    
    console.log(`  ✅ Successfully added ${totalAdded}/${docs.length} chunks`);
    
    return {
      success: true,
      fileName,
      chunksProcessed: totalAdded,
      totalChunks: docs.length
    };
    
  } catch (error) {
    console.error(`  ❌ Error processing ${fileName}:`, error.message);
    return {
      success: false,
      fileName,
      error: error.message,
      chunksProcessed: 0
    };
  }
}

// Process a batch of chunks with manual embeddings
async function processChunkBatch(docs, fileName, startIndex) {
  try {
    // Prepare data for ChromaDB
    const documents = docs.map(doc => doc.pageContent);
    const ids = docs.map((_, idx) => `${fileName}_chunk_${startIndex + idx}`);
    
    // Create clean metadata
    const metadatas = docs.map((doc, idx) => {
      return cleanMetadata({
        filename: fileName,
        source: fileName,
        title: fileName.replace('.PDF', '').replace(/_/g, ' '),
        chunk_index: startIndex + idx,
        total_chunks: docs.length,
        processed_at: new Date().toISOString()
      });
    });
    
    // Generate embeddings manually using Gemini API
    console.log(`      🧠 Generating embeddings for ${documents.length} chunks...`);
    const embeddings = [];
    
    for (let i = 0; i < documents.length; i++) {
      try {
        const embedding = await generateEmbedding(documents[i]);
        embeddings.push(embedding);
        console.log(`      ✅ Generated embedding ${i + 1}/${documents.length}`);
        
        // Rate limiting between embedding calls
        if (i < documents.length - 1) {
          await sleep(1000); // 1 second delay between calls
        }
      } catch (error) {
        console.error(`      ❌ Failed to generate embedding for chunk ${i + 1}: ${error.message}`);
        throw error;
      }
}

    // Add to ChromaDB with manual embeddings (bypassing automatic embedding function)
    console.log(`      💾 Adding ${documents.length} chunks with manual embeddings to ChromaDB...`);
    
    let retries = 0;
    while (retries < MAX_RETRIES) {
      try {
        await collection.add({
          ids: ids,
          embeddings: embeddings, // Manual embeddings
          documents: documents,
          metadatas: metadatas
        });
        
        console.log(`      ✅ Added batch of ${documents.length} chunks with manual embeddings`);
        return documents.length;
      } catch (error) {
        retries++;
        if (retries >= MAX_RETRIES) {
          throw error;
        }
        console.log(`      ⚠️ Retry ${retries}/${MAX_RETRIES} for ChromaDB batch`);
        await sleep(1000 * retries); // Exponential backoff
      }
    }
  } catch (error) {
    console.error(`      ❌ Failed to process chunk batch: ${error.message}`);
    return 0;
  }
}

// Process PDFs and store in ChromaDB
async function processPDFs() {
  try {
    await initializeCollection();
    
    console.log('📁 Reading PDF directory...');
const pdfDir = path.join(process.cwd(), 'pdfs');
    
if (!fs.existsSync(pdfDir)) {
      console.error(`❌ PDF folder missing at ${pdfDir}`);
  process.exit(1);
}

    // Get first 5 PDF files (simple approach)
    const allFiles = fs.readdirSync(pdfDir)
      .filter(f => f.toLowerCase().endsWith('.pdf'))
      .sort()
      .slice(0, MAX_PDFS); // Only take first 5 PDFs
    
    console.log(`📚 Found ${allFiles.length} PDFs (limited to first ${MAX_PDFS})`);
    
    if (allFiles.length === 0) {
      console.log('🎉 No PDFs to process!');
      return;
    }
    
    console.log(`\n🚀 Processing ${allFiles.length} PDFs in batches of ${BATCH_SIZE}...`);
    console.log('━'.repeat(60));
    
    // Process in batches
    let totalChunksAdded = 0;
    
    for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
      const batch = allFiles.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(allFiles.length / BATCH_SIZE);

      console.log(`\n📦 Processing Batch ${batchNumber}/${totalBatches} (${batch.length} files)`);
      console.log('─'.repeat(40));
      
      // Process batch in parallel
      const batchPromises = batch.map((file, idx) => 
        processPDF(path.join(pdfDir, file), file, i + idx, allFiles.length)
      );
      const batchResults = await Promise.all(batchPromises);
      
      // Update progress tracking
      for (const result of batchResults) {
        processedCount++;
        
        if (result.success) {
          successLog.push(result);
          totalChunksAdded += result.chunksProcessed;
          console.log(`✅ ${result.fileName}: ${result.chunksProcessed} chunks`);
        } else {
          errorLog.push(result);
          console.log(`❌ ${result.fileName}: ${result.error}`);
        }
      }
      
      // Progress summary
      const successRate = ((successLog.length / processedCount) * 100).toFixed(1);
      console.log(`\n📈 Progress: ${processedCount}/${allFiles.length} files (${successRate}% success rate)`);
      console.log(`📊 Total chunks added: ${totalChunksAdded}`);
      
      // Rate limiting between batches
      if (i + BATCH_SIZE < allFiles.length) {
        console.log('⏳ Waiting between batches...');
        await sleep(2000);
      }
    }
    
    // Final verification and summary
    console.log('\n🎉 PROCESSING COMPLETE!');
    console.log('━'.repeat(60));
    
    const finalCount = await collection.count();
    console.log(`📊 ChromaDB contains ${finalCount} document chunks total`);
    console.log(`✅ Successfully processed: ${successLog.length} PDFs`);
    console.log(`❌ Failed to process: ${errorLog.length} PDFs`);
    console.log(`📈 Total chunks added this run: ${totalChunksAdded}`);
    
    if (errorLog.length > 0) {
      console.log('\n❌ Failed files:');
      errorLog.forEach(error => {
        console.log(`   • ${error.fileName}: ${error.error}`);
      });
    }
    
    if (finalCount > 0) {
      console.log('\n✅ SUCCESS: Your legal documents are now searchable!');
      console.log('🚀 Ready to start your Legal QA system: npm run start');
    } else {
      console.log('\n❌ WARNING: No documents were successfully processed');
    }
    
  } catch (error) {
    console.error('❌ FATAL ERROR during processing:', error.message);
    throw error;
  }
}

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('\n⏹️  Processing interrupted by user');
process.exit(0);
});

// Main execution
async function main() {
  try {
    console.log('🔍 System Check...');
    console.log(`   ChromaDB: http://${CHROMA_URL}:${CHROMA_PORT}`);
    console.log(`   PDF Directory: ${path.join(process.cwd(), 'pdfs')}`);
    console.log(`   Max PDFs: ${MAX_PDFS} files`);
    console.log(`   Batch Size: ${BATCH_SIZE} PDFs at a time`);
    console.log(`   Chunk Batch: ${CHUNK_BATCH_SIZE} chunks at a time`);
    console.log(`   Gemini API: ${GEMINI_API_KEY ? '✅ Configured' : '❌ Missing'}`);
    console.log('');
    
    // Validate Gemini API key
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('your-actual-gemini-api-key-here')) {
      throw new Error('Valid GEMINI_API_KEY is required for manual embedding generation');
    }
    
    await processPDFs();
    process.exit(0);
  } catch (error) {
    console.error('💥 Script failed:', error.message);
    process.exit(1);
  }
}

main();
