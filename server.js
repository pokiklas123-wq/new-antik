const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// رابط SheetDB
const SHEETDB_URL = process.env.SHEETDB_URL || 'https://sheetdb.io/api/v1/apfdlqhkkqm7m';

// 1. القراءة: جلب جميع البيانات (GET) - يرجع البيانات مباشرة
app.get('/', async (req, res) => {
    try {
        const response = await axios.get(SHEETDB_URL);
        // إرجاع البيانات مباشرة بدون غلاف
        res.json(response.data);
    } catch (error) {
        console.error('Error fetching data:', error.message);
        // في حالة خطأ، نرجع مصفوفة فارغة أو رسالة خطأ بسيطة
        res.status(500).json([]);
    }
});

// 2. الإنشاء: إضافة سجل جديد (POST) - يرجع الرد مباشرة من SheetDB
app.post('/', async (req, res) => {
    try {
        const data = req.body;
        
        if (!data || Object.keys(data).length === 0) {
            return res.status(400).json({ error: 'Request body is required' });
        }

        const response = await axios.post(SHEETDB_URL, { data: [data] });
        // إرجاع الرد مباشرة من SheetDB
        res.json(response.data);
    } catch (error) {
        console.error('Create error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// 3. البحث (POST) - يرجع البيانات مباشرة
app.post('/search', async (req, res) => {
    try {
        const { column, value } = req.body;
        
        if (!column || !value) {
            return res.status(400).json({ error: 'Column and value are required' });
        }

        const searchUrl = `${SHEETDB_URL}/search?${column}=${encodeURIComponent(value)}`;
        const response = await axios.get(searchUrl);
        
        // إرجاع البيانات مباشرة
        res.json(response.data);
    } catch (error) {
        console.error('Search error:', error.message);
        res.status(500).json([]);
    }
});

// 4. الحصول على سجل معين (POST)
app.post('/getrow', async (req, res) => {
    try {
        const { id } = req.body;
        
        if (!id) {
            return res.status(400).json({ error: 'ID is required' });
        }

        const response = await axios.get(`${SHEETDB_URL}/id/${id}`);
        // إرجاع البيانات مباشرة
        res.json(response.data);
    } catch (error) {
        console.error('Row fetch error:', error.message);
        res.status(404).json(null);
    }
});

// 5. التحديث (PUT) - يرجع الرد مباشرة
app.put('/', async (req, res) => {
    try {
        const { id, column, value } = req.body;
        
        if (!id || !column || !value) {
            return res.status(400).json({ error: 'id, column, and value are required' });
        }

        const updateUrl = `${SHEETDB_URL}/id/${id}/${column}`;
        const response = await axios.put(updateUrl, { value });
        
        // إرجاع الرد مباشرة
        res.json(response.data);
    } catch (error) {
        console.error('Update error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// 6. الحذف (DELETE) - يرجع الرد مباشرة
app.delete('/', async (req, res) => {
    try {
        const { id } = req.body;
        
        if (!id) {
            return res.status(400).json({ error: 'ID is required' });
        }

        const deleteUrl = `${SHEETDB_URL}/id/${id}`;
        const response = await axios.delete(deleteUrl);
        
        // إرجاع الرد مباشرة
        res.json(response.data);
    } catch (error) {
        console.error('Delete error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// 7. نقطة للتحقق من صحة الخادم فقط (لا تؤثر على تطبيقك)
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// بدء الخادم
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
    console.log(`📊 Proxying to SheetDB: ${SHEETDB_URL}`);
    console.log(`✅ API returns data directly without wrapper`);
});
