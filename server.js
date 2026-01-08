const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const SHEETDB_URL = 'https://sheetdb.io/api/v1/mnzgv5245hdg8';

// Middleware
app.use(express.json());

// CORS للفيرباس
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// ============================================
// 1. GET - للفيرباس (يرجع object مباشر، ليس array)
// ============================================
app.get('/', async (req, res) => {
    try {
        const response = await axios.get(SHEETDB_URL);
        const data = response.data;
        
        // إذا كان هناك بيانات
        if (data && data.length > 0) {
            // إرجاع أول عنصر كـ object مباشر (ليس داخل array)
            res.json(data[0]);
        } else {
            // إذا لا يوجد بيانات، إرجاع object فارغ
            res.json({});
        }
    } catch (error) {
        console.error('Firebase GET Error:', error.message);
        res.json({}); // إرجاع object فارغ للفيرباس
    }
});

// ============================================
// 2. GET ALL - إذا أردت جميع السجلات (اختياري)
// ============================================
app.get('/all', async (req, res) => {
    try {
        const response = await axios.get(SHEETDB_URL);
        res.json(response.data);
    } catch (error) {
        console.error('GET ALL Error:', error.message);
        res.json([]);
    }
});

// ============================================
// 3. POST - إضافة/تحديث للفيرباس
// ============================================
app.post('/', async (req, res) => {
    try {
        const firebaseData = req.body;
        
        if (!firebaseData || Object.keys(firebaseData).length === 0) {
            return res.status(400).json({ error: 'No Firebase data provided' });
        }
        
        // جلب البيانات الحالية من SheetDB
        const currentResponse = await axios.get(SHEETDB_URL);
        const currentData = currentResponse.data;
        
        if (currentData && currentData.length > 0) {
            // إذا يوجد بيانات، نقوم بالتحديث للسطر الأول
            const firstRowId = currentData[0].id || '1';
            const response = await axios.put(
                `${SHEETDB_URL}/id/${firstRowId}`,
                { data: firebaseData }
            );
            res.json(response.data);
        } else {
            // إذا لا يوجد بيانات، ننشئ سطر جديد
            const response = await axios.post(SHEETDB_URL, { data: [firebaseData] });
            res.json(response.data);
        }
    } catch (error) {
        console.error('Firebase POST Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// 4. PUT - تحديث حقل محدد (مثل فيرباس update)
// ============================================
app.put('/', async (req, res) => {
    try {
        const { field, value } = req.body;
        
        if (!field || value === undefined) {
            return res.status(400).json({ error: 'Field and value are required' });
        }
        
        // جلب البيانات الحالية
        const currentResponse = await axios.get(SHEETDB_URL);
        const currentData = currentResponse.data;
        
        if (currentData && currentData.length > 0) {
            const firstRowId = currentData[0].id || '1';
            const response = await axios.put(
                `${SHEETDB_URL}/id/${firstRowId}/${field}`,
                { value }
            );
            res.json(response.data);
        } else {
            res.status(404).json({ error: 'No data found to update' });
        }
    } catch (error) {
        console.error('Firebase PUT Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// 5. DELETE - حذف (مثل فيرباس delete)
// ============================================
app.delete('/', async (req, res) => {
    try {
        const { field } = req.body;
        
        // جلب البيانات الحالية
        const currentResponse = await axios.get(SHEETDB_URL);
        const currentData = currentResponse.data;
        
        if (currentData && currentData.length > 0) {
            const firstRowId = currentData[0].id || '1';
            
            if (field) {
                // حذف حقل محدد (تعيينه كـ null)
                const response = await axios.put(
                    `${SHEETDB_URL}/id/${firstRowId}/${field}`,
                    { value: null }
                );
                res.json(response.data);
            } else {
                // حذف السطر كامل
                const response = await axios.delete(`${SHEETDB_URL}/id/${firstRowId}`);
                res.json(response.data);
            }
        } else {
            res.status(404).json({ error: 'No data found to delete' });
        }
    } catch (error) {
        console.error('Firebase DELETE Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// 6. PATCH - تحديث جزئي (مثل فيرباس)
// ============================================
app.patch('/', async (req, res) => {
    try {
        const updates = req.body;
        
        if (!updates || Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No updates provided' });
        }
        
        // جلب البيانات الحالية
        const currentResponse = await axios.get(SHEETDB_URL);
        const currentData = currentResponse.data;
        
        if (currentData && currentData.length > 0) {
            const firstRowId = currentData[0].id || '1';
            
            // تحديث الحقول واحداً تلو الآخر
            const updatePromises = Object.keys(updates).map(field => 
                axios.put(`${SHEETDB_URL}/id/${firstRowId}/${field}`, { 
                    value: updates[field] 
                })
            );
            
            await Promise.all(updatePromises);
            res.json({ success: true, updatedFields: Object.keys(updates) });
        } else {
            res.status(404).json({ error: 'No data found to update' });
        }
    } catch (error) {
        console.error('Firebase PATCH Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// 7. Health Check للفيرباس
// ============================================
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'Firebase-Compatible SheetDB Proxy',
        compatible: true,
        endpoints: {
            'GET /': 'Get first record as object (Firebase style)',
            'GET /all': 'Get all records as array',
            'POST /': 'Create or update record',
            'PUT /': 'Update specific field',
            'PATCH /': 'Partial update',
            'DELETE /': 'Delete field or record'
        }
    });
});

// ============================================
// بدء الخادم
// ============================================
app.listen(PORT, () => {
    console.log(`🔥 Firebase-Compatible Server running on port ${PORT}`);
    console.log(`📡 SheetDB URL: ${SHEETDB_URL}`);
    console.log(`🎯 Returns: Object (not Array) for Firebase compatibility`);
});
