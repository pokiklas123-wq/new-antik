const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// إخفاء رابط SheetDB الخاص بك في متغير بيئة
const SHEETDB_URL = process.env.SHEETDB_URL || 'https://sheetdb.io/api/v1/apfdlqhkkqm7m';
const SHEETDB_API_KEY = process.env.SHEETDB_API_KEY || 'apfdlqhkkqm7m';

// 1. CRUD الرئيسية (بدون مسارات فرعية)
// =========================================

// القراءة: جلب جميع البيانات (GET)
app.get('/', async (req, res) => {
    try {
        const response = await axios.get(SHEETDB_URL);
        res.json({
            success: true,
            data: response.data,
            count: response.data.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching data:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch data from SheetDB',
            error: error.message
        });
    }
});

// الإنشاء: إضافة سجل جديد (POST)
app.post('/', async (req, res) => {
    try {
        const data = req.body;
        
        if (!data || Object.keys(data).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Request body is required'
            });
        }

        const response = await axios.post(SHEETDB_URL, { data: [data] });
        
        res.json({
            success: true,
            message: 'Record added successfully',
            data: response.data,
            created: data
        });
    } catch (error) {
        console.error('Create error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to create record',
            error: error.message
        });
    }
});

// التحديث: تحديث سجل (PUT)
app.put('/', async (req, res) => {
    try {
        const { id, column, value, data } = req.body;
        
        // الطريقة 1: تحديث باستخدام ID و column
        if (id && column && value) {
            const updateUrl = `${SHEETDB_URL}/id/${id}/${column}`;
            const response = await axios.put(updateUrl, { value });
            
            return res.json({
                success: true,
                message: 'Record updated successfully',
                data: response.data
            });
        }
        
        // الطريقة 2: تحديث كامل السجل
        if (data && data.id) {
            const updateUrl = `${SHEETDB_URL}/id/${data.id}`;
            const response = await axios.put(updateUrl, { data });
            
            return res.json({
                success: true,
                message: 'Record fully updated',
                data: response.data
            });
        }
        
        res.status(400).json({
            success: false,
            message: 'Either provide id/column/value or full data object with id'
        });
        
    } catch (error) {
        console.error('Update error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to update record',
            error: error.message
        });
    }
});

// الحذف: حذف سجل (DELETE)
app.delete('/', async (req, res) => {
    try {
        const { id, column, value } = req.body;
        
        if (id) {
            // الحذف باستخدام ID
            const deleteUrl = `${SHEETDB_URL}/id/${id}`;
            await axios.delete(deleteUrl);
            
            return res.json({
                success: true,
                message: 'Record deleted successfully',
                deletedId: id
            });
        }
        
        if (column && value) {
            // الحذف باستخدام column/value
            const deleteUrl = `${SHEETDB_URL}/${column}/${encodeURIComponent(value)}`;
            await axios.delete(deleteUrl);
            
            return res.json({
                success: true,
                message: 'Records deleted successfully',
                condition: { column, value }
            });
        }
        
        res.status(400).json({
            success: false,
            message: 'Provide either id or column/value pair'
        });
        
    } catch (error) {
        console.error('Delete error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to delete record',
            error: error.message
        });
    }
});

// 2. عمليات خاصة (بدون مسارات فرعية)
// =====================================

// البحث (POST للبحث المعقد)
app.post('/search', async (req, res) => {
    try {
        const { conditions, logical = 'AND' } = req.body;
        
        if (!conditions || !Array.isArray(conditions)) {
            return res.status(400).json({
                success: false,
                message: 'Conditions array is required'
            });
        }

        // بناء استعلام البحث
        const searchParams = new URLSearchParams();
        conditions.forEach(cond => {
            if (cond.column && cond.value) {
                searchParams.append(cond.column, cond.value);
            }
        });
        
        const searchUrl = `${SHEETDB_URL}/search?${searchParams.toString()}`;
        const response = await axios.get(searchUrl);
        
        res.json({
            success: true,
            data: response.data,
            conditions,
            logical,
            count: response.data.length
        });
    } catch (error) {
        console.error('Search error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Search failed',
            error: error.message
        });
    }
});

// الحصول على سجل معين (POST بدلاً من GET مع باراميتر)
app.post('/getrow', async (req, res) => {
    try {
        const { id } = req.body;
        
        if (!id) {
            return res.status(400).json({
                success: false,
                message: 'ID is required'
            });
        }

        const response = await axios.get(`${SHEETDB_URL}/id/${id}`);
        
        res.json({
            success: true,
            data: response.data,
            rowId: id
        });
    } catch (error) {
        console.error('Row fetch error:', error.message);
        res.status(404).json({
            success: false,
            message: 'Row not found',
            error: error.message
        });
    }
});

// إضافة عدة سجلات دفعة واحدة
app.post('/batch', async (req, res) => {
    try {
        const { data } = req.body;
        
        if (!data || !Array.isArray(data)) {
            return res.status(400).json({
                success: false,
                message: 'Data array is required'
            });
        }

        const response = await axios.post(SHEETDB_URL, { data });
        
        res.json({
            success: true,
            message: `${data.length} records added successfully`,
            data: response.data,
            count: data.length
        });
    } catch (error) {
        console.error('Batch create error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to add batch records',
            error: error.message
        });
    }
});

// 3. عمليات متقدمة
// ==================

// تعداد الأعمدة (الحقول)
app.get('/columns', async (req, res) => {
    try {
        const response = await axios.get(SHEETDB_URL);
        const firstRow = response.data[0];
        
        if (!firstRow) {
            return res.json({
                success: true,
                columns: [],
                count: 0
            });
        }
        
        const columns = Object.keys(firstRow);
        
        res.json({
            success: true,
            columns: columns,
            count: columns.length
        });
    } catch (error) {
        console.error('Columns error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to get columns',
            error: error.message
        });
    }
});

// إحصائيات البيانات
app.get('/stats', async (req, res) => {
    try {
        const response = await axios.get(SHEETDB_URL);
        const data = response.data;
        
        if (data.length === 0) {
            return res.json({
                success: true,
                stats: {
                    totalRecords: 0,
                    columns: 0,
                    message: 'No data available'
                }
            });
        }
        
        const firstRow = data[0];
        const columns = Object.keys(firstRow);
        
        // جمع إحصائيات لكل عمود
        const columnStats = {};
        columns.forEach(column => {
            const values = data.map(row => row[column]).filter(val => val !== undefined);
            columnStats[column] = {
                count: values.length,
                sampleValues: values.slice(0, 3),
                hasValues: values.length > 0
            };
        });
        
        res.json({
            success: true,
            stats: {
                totalRecords: data.length,
                totalColumns: columns.length,
                columnNames: columns,
                columnStats: columnStats,
                lastUpdated: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Stats error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to get statistics',
            error: error.message
        });
    }
});

// 4. نقاط نهاية مساعدة
// =====================

// التحقق من صحة الخادم
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'SheetDB Proxy',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        features: ['CRUD', 'Search', 'Batch Operations', 'Statistics']
    });
});

// معلومات عن API
app.get('/info', (req, res) => {
    res.json({
        service: 'SheetDB Proxy API',
        description: 'Full CRUD operations without slashes in URL',
        version: '1.0.0',
        endpoints: {
            'GET /': 'Get all records',
            'POST /': 'Create new record',
            'PUT /': 'Update record',
            'DELETE /': 'Delete record',
            'POST /search': 'Search records',
            'POST /getrow': 'Get specific row',
            'POST /batch': 'Add multiple records',
            'GET /columns': 'Get column names',
            'GET /stats': 'Get data statistics',
            'GET /health': 'Health check',
            'GET /info': 'This information'
        },
        note: 'All operations use POST/GET/PUT/DELETE on root or with simple paths'
    });
});

// 5. معالجة الأخطاء العامة
// ==========================
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint not found',
        availableEndpoints: [
            'GET    /',
            'POST   /',
            'PUT    /',
            'DELETE /',
            'POST   /search',
            'POST   /getrow',
            'POST   /batch',
            'GET    /columns',
            'GET    /stats',
            'GET    /health',
            'GET    /info'
        ]
    });
});

// بدء الخادم
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
    console.log(`📊 Proxying to SheetDB: ${SHEETDB_URL}`);
    console.log(`🌐 API available at: http://localhost:${PORT}`);
    console.log(`🔧 Ready for CRUD operations without slash paths`);
});
