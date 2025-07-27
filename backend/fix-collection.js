// Simple fix for ChromaDB embedding function issue
import { ChromaClient } from 'chromadb';
import dotenv from 'dotenv';

dotenv.config();

const chroma = new ChromaClient({
  path: `http://${process.env.CHROMA_HOST || 'localhost'}:${process.env.CHROMA_PORT || 8000}`
});

async function fixCollection() {
  try {
    const COLLECTION_NAME = process.env.CHROMA_COLLECTION || 'legal_cases';
    
    console.log('🔧 Fixing ChromaDB collection...');
    
    // Delete the problematic collection
    try {
      await chroma.deleteCollection({ name: COLLECTION_NAME });
      console.log('✅ Deleted problematic collection');
    } catch (e) {
      console.log('ℹ️  Collection already deleted or doesn\'t exist');
    }
    
    // Create new collection (ChromaDB will use default embedding automatically)
    await chroma.createCollection({ name: COLLECTION_NAME });
    console.log('✅ Created new collection with proper embedding function');
    
    console.log('\n🎉 Collection fixed!');
    console.log('📋 Next steps:');
    console.log('   1. Run: npm run preprocess');
    console.log('   2. Run: npm run start');
    
  } catch (error) {
    console.error('❌ Fix failed:', error.message);
  }
}

fixCollection(); 