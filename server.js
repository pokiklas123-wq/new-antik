const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const SHEETDB_URL = 'https://sheetdb.io/api/v1/apfdlqhkkqm7m';

// Middleware
app.use(cors());
app.use(express.json());

// ============================================
// 1. جلب جميع القصص (Firebase Realtime Style)
// ============================================
app.get('/.json', async (req, res) => {
    try {
        console.log('📖 جلب جميع القصص...');
        const response = await axios.get(SHEETDB_URL);
        const stories = response.data || [];
        
        // تحويل إلى هيكل Firebase: { "story_id": {data} }
        const firebaseData = {};
        stories.forEach(story => {
            if (story.id) {
                firebaseData[story.id] = {
                    cover: story.cover || '',
                    title: story.title || '',
                    likes: parseInt(story.likes) || 0,
                    comments: parseInt(story.comments) || 0,
                    url: story.url || '',
                    latestChapter: story.latestChapter || '',
                    status: story.status || 'active',
                    lastUpdated: Date.now()
                };
            }
        });
        
        res.json(firebaseData);
    } catch (error) {
        console.error('❌ خطأ في جلب القصص:', error.message);
        res.json({});
    }
});

// ============================================
// 2. جلب قصة محددة
// ============================================
app.get('/:storyId.json', async (req, res) => {
    try {
        const { storyId } = req.params;
        console.log(`📖 جلب قصة: ${storyId}`);
        
        const response = await axios.get(SHEETDB_URL);
        const stories = response.data || [];
        
        const story = stories.find(s => s.id === storyId);
        
        if (story) {
            res.json({
                cover: story.cover || '',
                title: story.title || '',
                likes: parseInt(story.likes) || 0,
                comments: parseInt(story.comments) || 0,
                url: story.url || '',
                latestChapter: story.latestChapter || '',
                status: story.status || 'active'
            });
        } else {
            res.status(404).json(null);
        }
    } catch (error) {
        console.error('❌ خطأ في جلب القصة:', error.message);
        res.json(null);
    }
});

// ============================================
// 3. زيادة الإعجابات (Like)
// ============================================
app.post('/:storyId/like', async (req, res) => {
    try {
        const { storyId } = req.params;
        console.log(`👍 زيادة إعجاب لقصة: ${storyId}`);
        
        // جلب القصة الحالية
        const response = await axios.get(SHEETDB_URL);
        const stories = response.data || [];
        const storyIndex = stories.findIndex(s => s.id === storyId);
        
        if (storyIndex !== -1) {
            // زيادة الإعجابات
            const currentLikes = parseInt(stories[storyIndex].likes) || 0;
            stories[storyIndex].likes = (currentLikes + 1).toString();
            
            // هنا يمكنك تحديث Google Sheets
            // للتبسيط: نرجع النجاح فقط
            res.json({
                success: true,
                storyId,
                newLikes: stories[storyIndex].likes,
                message: 'تم زيادة الإعجاب'
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'القصة غير موجودة'
            });
        }
    } catch (error) {
        console.error('❌ خطأ في زيادة الإعجاب:', error.message);
        res.json({ success: false, error: error.message });
    }
});

// ============================================
// 4. زيادة التعليقات
// ============================================
app.post('/:storyId/comment', async (req, res) => {
    try {
        const { storyId } = req.params;
        console.log(`💬 زيادة تعليق لقصة: ${storyId}`);
        
        // نفس منطق الإعجابات
        res.json({
            success: true,
            storyId,
            message: 'تم زيادة التعليق'
        });
    } catch (error) {
        console.error('❌ خطأ في زيادة التعليق:', error.message);
        res.json({ success: false, error: error.message });
    }
});

// ============================================
// 5. البحث عن القصص
// ============================================
app.get('/search/:query', async (req, res) => {
    try {
        const { query } = req.params;
        console.log(`🔍 بحث عن: ${query}`);
        
        const response = await axios.get(SHEETDB_URL);
        const allStories = response.data || [];
        
        // فلترة النتائج
        const results = allStories.filter(story => {
            return (
                (story.title && story.title.toLowerCase().includes(query.toLowerCase())) ||
                (story.id && story.id.toLowerCase().includes(query.toLowerCase()))
            );
        });
        
        // تحويل إلى هيكل Firebase
        const firebaseResults = {};
        results.forEach(story => {
            if (story.id) {
                firebaseResults[story.id] = story;
            }
        });
        
        res.json(firebaseResults);
    } catch (error) {
        console.error('❌ خطأ في البحث:', error.message);
        res.json({});
    }
});

// ============================================
// 6. القصص الأكثر إعجاباً
// ============================================
app.get('/top/likes', async (req, res) => {
    try {
        const response = await axios.get(SHEETDB_URL);
        const stories = response.data || [];
        
        // ترتيب تنازلي حسب الإعجابات
        const sorted = [...stories]
            .filter(s => s.likes)
            .sort((a, b) => (parseInt(b.likes) || 0) - (parseInt(a.likes) || 0))
            .slice(0, 20); // أول 20
        
        const firebaseData = {};
        sorted.forEach(story => {
            if (story.id) {
                firebaseData[story.id] = story;
            }
        });
        
        res.json(firebaseData);
    } catch (error) {
        console.error('❌ خطأ في جلب الأكثر إعجاباً:', error.message);
        res.json({});
    }
});

// ============================================
// 7. القصص الأكثر تعليقاً
// ============================================
app.get('/top/comments', async (req, res) => {
    try {
        const response = await axios.get(SHEETDB_URL);
        const stories = response.data || [];
        
        // ترتيب تنازلي حسب التعليقات
        const sorted = [...stories]
            .filter(s => s.comments)
            .sort((a, b) => (parseInt(b.comments) || 0) - (parseInt(a.comments) || 0))
            .slice(0, 20);
        
        const firebaseData = {};
        sorted.forEach(story => {
            if (story.id) {
                firebaseData[story.id] = story;
            }
        });
        
        res.json(firebaseData);
    } catch (error) {
        console.error('❌ خطأ في جلب الأكثر تعليقاً:', error.message);
        res.json({});
    }
});

// ============================================
// 8. Health Check (للفيرباس)
// ============================================
app.get('/.settings/rules.json', (req, res) => {
    res.json({
        "rules": {
            ".read": true,
            ".write": false // للقراءة فقط
        }
    });
});

// ============================================
// 9. بدء الخادم
// ============================================
app.listen(PORT, () => {
    console.log(`🔥 Firebase Emulator for Manga/Novels`);
    console.log(`📚 Running on port: ${PORT}`);
    console.log(`🔗 Firebase URL: http://localhost:${PORT}`);
    console.log('📖 Endpoints:');
    console.log('   GET  /.json              # جميع القصص');
    console.log('   GET  /{id}.json          # قصة محددة');
    console.log('   POST /{id}/like          # زيادة إعجاب');
    console.log('   POST /{id}/comment       # زيادة تعليق');
    console.log('   GET  /search/{query}     # بحث');
    console.log('   GET  /top/likes          # الأكثر إعجاباً');
    console.log('   GET  /top/comments       # الأكثر تعليقاً');
});
