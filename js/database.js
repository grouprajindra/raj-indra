/* ========================================
   Raj Indra Group — Database Layer v3.0
   LocalStorage + Google Sheets Auto-Sync
   + Real Email via Google Apps Script
   ======================================== */

const DB = {
    // Keys
    USERS: 'rig_users',
    LEADS: 'rig_leads',
    INVOICES: 'rig_invoices',
    APPROVALS: 'rig_approvals',
    NOTIFICATIONS: 'rig_notifications',
    SESSION: 'rig_session',
    COUNTER: 'rig_counter',
    CONFIG: 'rig_config',

    // Google Sheets Config
    SHEETS_URL: 'https://docs.google.com/spreadsheets/d/11rJ7BRVTy_v11oex5jmEsYb7chmnwiDk9TntFtCocp8/edit', // Will be set from config

    // Sync queue for offline resilience
    _syncQueue: [],
    _isSyncing: false,

    // Initialize with default admin
    init() {
        if (!localStorage.getItem(this.USERS)) {
            const admin = {
                id: 'USR001',
                employeeId: 'RIG-ADMIN-001',
                name: 'Admin',
                email: 'admin@rajindra.com',
                phone: '+91 98765 00000',
                password: 'admin123',
                role: 'admin',
                status: 'approved',
                photo: '',
                address: 'Head Office, New Delhi',
                aadhar: '',
                pan: '',
                bankName: '',
                bankAccount: '',
                ifsc: '',
                designation: 'Managing Director',
                department: 'Management',
                joinDate: '2024-01-01',
                createdAt: new Date().toISOString()
            };
            localStorage.setItem(this.USERS, JSON.stringify([admin]));
        }
        if (!localStorage.getItem(this.LEADS)) localStorage.setItem(this.LEADS, JSON.stringify([]));
        if (!localStorage.getItem(this.INVOICES)) localStorage.setItem(this.INVOICES, JSON.stringify([]));
        if (!localStorage.getItem(this.APPROVALS)) localStorage.setItem(this.APPROVALS, JSON.stringify([]));
        if (!localStorage.getItem(this.NOTIFICATIONS)) localStorage.setItem(this.NOTIFICATIONS, JSON.stringify([]));
        if (!localStorage.getItem(this.COUNTER)) localStorage.setItem(this.COUNTER, JSON.stringify({ user: 1, lead: 0, invoice: 0, approval: 0 }));

        // Load Google Sheets URL from config
        const config = JSON.parse(localStorage.getItem(this.CONFIG) || '{}');
        this.SHEETS_URL = config.sheetsUrl || '';

        // Process any pending sync queue
        this._loadSyncQueue();
        if (this._syncQueue.length > 0) {
            this._processSyncQueue();
        }
    },

    // ===== Google Sheets Integration =====
    setSheetsUrl(url) {
        const config = JSON.parse(localStorage.getItem(this.CONFIG) || '{}');
        config.sheetsUrl = url;
        localStorage.setItem(this.CONFIG, JSON.stringify(config));
        this.SHEETS_URL = url;
    },

    getSheetsUrl() {
        return this.SHEETS_URL;
    },

    // ===== Google Apps Script fetch =====
    // Google Apps Script redirects (302) on POST. Browsers block this due to CORS.
    // Solution: mode:'no-cors' sends the data successfully (fire-and-forget).
    // The data DOES reach Google Sheets, but response is opaque (can't read it).
    async _postToSheets(data) {
        if (!this.SHEETS_URL) return { success: false, message: 'Google Sheets URL not configured' };
        
        try {
            await fetch(this.SHEETS_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(data)
            });
            // With no-cors, response is opaque but data IS sent to server
            return { success: true, message: 'Data sent to Google Sheets' };
        } catch (err) {
            console.error('Sheets API error:', err);
            return { success: false, message: 'Network error: ' + err.message };
        }
    },

    // Test connection to Google Sheets (GET request works without CORS issues)
    async testConnection() {
        if (!this.SHEETS_URL) return { success: false, message: 'Google Sheets URL not set' };
        try {
            // GET requests to Google Apps Script follow redirects and return JSON
            const response = await fetch(this.SHEETS_URL, { redirect: 'follow' });
            if (response.ok) {
                try {
                    const data = await response.json();
                    return { success: true, message: 'Connected! ' + (data.message || ''), sheetUrl: data.sheetUrl || '' };
                } catch(e) {
                    return { success: true, message: 'Connected! (Response received)' };
                }
            }
            return { success: false, message: 'Server returned status ' + response.status };
        } catch(err) {
            // Even if CORS blocks reading response, the URL might still work for POST
            return { success: false, message: 'Connection test failed: ' + err.message + '. Note: POST sync may still work.' };
        }
    },

    // Sync data to Google Sheets (single record)
    async syncToSheets(sheetName, data) {
        const result = await this._postToSheets({ action: 'sync', sheet: sheetName, data: data });
        if (!result.success && result.message && result.message.indexOf('Network') > -1) {
            // Queue for retry
            this._addToSyncQueue({ action: 'sync', sheet: sheetName, data: data });
        }
        return result;
    },

    // Full sync all data to Google Sheets
    async syncAllToSheets() {
        if (!this.SHEETS_URL) return { success: false, message: 'Google Sheets URL not configured' };

        const allData = {
            action: 'syncAll',
            employees: this.getAll(this.USERS).map(u => {
                const { password, photo, ...safe } = u;
                return safe;
            }),
            leads: this.getAll(this.LEADS),
            invoices: this.getAll(this.INVOICES),
            approvals: this.getAll(this.APPROVALS)
        };

        const result = await this._postToSheets(allData);
        return result;
    },

    // ===== Sync Queue (offline resilience) =====
    _loadSyncQueue() {
        try {
            this._syncQueue = JSON.parse(localStorage.getItem('rig_sync_queue') || '[]');
        } catch(e) {
            this._syncQueue = [];
        }
    },

    _saveSyncQueue() {
        localStorage.setItem('rig_sync_queue', JSON.stringify(this._syncQueue));
    },

    _addToSyncQueue(data) {
        this._syncQueue.push({ data: data, timestamp: Date.now() });
        this._saveSyncQueue();
    },

    async _processSyncQueue() {
        if (this._isSyncing || !this.SHEETS_URL || this._syncQueue.length === 0) return;
        this._isSyncing = true;

        const failedItems = [];
        for (const item of this._syncQueue) {
            const result = await this._postToSheets(item.data);
            if (!result.success) {
                // Keep failed items for retry, but only if less than 24 hours old
                if (Date.now() - item.timestamp < 86400000) {
                    failedItems.push(item);
                }
            }
        }

        this._syncQueue = failedItems;
        this._saveSyncQueue();
        this._isSyncing = false;
    },

    // ===== Auto-sync trigger after any data change =====
    _autoSync() {
        // Debounced auto-sync: waits 2 seconds after last change
        if (this._autoSyncTimer) clearTimeout(this._autoSyncTimer);
        this._autoSyncTimer = setTimeout(() => {
            this.syncAllToSheets().then(result => {
                if (result.success) {
                    console.log('✅ Auto-synced to Google Sheets');
                } else {
                    console.warn('⚠️ Auto-sync failed:', result.message);
                }
            });
        }, 2000);
    },

    // ===== REAL EMAIL via Google Apps Script =====
    async sendEmail(toEmail, toName, subject, body) {
        if (!this.SHEETS_URL) {
            // Fallback: store locally
            this._simulateEmail(toEmail, toName, subject, body);
            return { success: false, message: 'Email stored locally (Google Sheets URL not configured)' };
        }

        try {
            const result = await this._postToSheets({
                action: 'sendEmail',
                to: toEmail,
                toName: toName,
                subject: subject,
                body: body
            });

            // Also log locally
            this._simulateEmail(toEmail, toName, subject, body);

            return result;
        } catch(err) {
            // Fallback to local storage
            this._simulateEmail(toEmail, toName, subject, body);
            return { success: false, message: 'Email queued locally: ' + err.message };
        }
    },

    // Local email log (always stores for reference)
    _simulateEmail(toEmail, toName, subject, body) {
        console.log(`📧 EMAIL to ${toEmail}:\nSubject: ${subject}\nBody: ${body}`);
        const emailLog = JSON.parse(localStorage.getItem('rig_emails') || '[]');
        emailLog.push({ to: toEmail, toName: toName, subject, body, sentAt: new Date().toISOString() });
        localStorage.setItem('rig_emails', JSON.stringify(emailLog));
    },

    // Get email log
    getEmailLog() {
        return JSON.parse(localStorage.getItem('rig_emails') || '[]').sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
    },

    // Generate IDs
    nextId(type) {
        const counters = JSON.parse(localStorage.getItem(this.COUNTER));
        counters[type]++;
        localStorage.setItem(this.COUNTER, JSON.stringify(counters));
        const prefixes = { user: 'USR', lead: 'LEAD', invoice: 'INV', approval: 'APR' };
        return `${prefixes[type]}${String(counters[type]).padStart(3, '0')}`;
    },

    nextEmployeeId() {
        const users = this.getAll(this.USERS);
        const empIds = users
            .filter(u => u.role === 'employee' && u.employeeId)
            .map(u => {
                const match = u.employeeId.match(/RIG-EMP-(\d+)/);
                return match ? parseInt(match[1]) : 0;
            });
        const maxNum = empIds.length > 0 ? Math.max(...empIds) : 0;
        return `RIG-EMP-${String(maxNum + 1).padStart(3, '0')}`;
    },

    // ===== Photo Management =====
    async processPhoto(file) {
        return new Promise((resolve, reject) => {
            if (!file) { resolve(''); return; }
            
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const MAX_SIZE = 300;
                    let width = img.width;
                    let height = img.height;
                    
                    if (width > height) {
                        if (width > MAX_SIZE) {
                            height *= MAX_SIZE / width;
                            width = MAX_SIZE;
                        }
                    } else {
                        if (height > MAX_SIZE) {
                            width *= MAX_SIZE / height;
                            height = MAX_SIZE;
                        }
                    }
                    
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    const compressed = canvas.toDataURL('image/jpeg', 0.7);
                    resolve(compressed);
                };
                img.onerror = () => reject(new Error('Failed to load image'));
                img.src = e.target.result;
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
    },

    // CRUD Operations
    getAll(key) {
        return JSON.parse(localStorage.getItem(key) || '[]');
    },

    getById(key, id) {
        return this.getAll(key).find(item => item.id === id);
    },

    add(key, item) {
        const items = this.getAll(key);
        items.push(item);
        localStorage.setItem(key, JSON.stringify(items));
        this._autoSync(); // Auto-sync on data change
        return item;
    },

    update(key, id, updates) {
        const items = this.getAll(key);
        const idx = items.findIndex(item => item.id === id);
        if (idx > -1) {
            items[idx] = { ...items[idx], ...updates, updatedAt: new Date().toISOString() };
            localStorage.setItem(key, JSON.stringify(items));
            this._autoSync(); // Auto-sync on data change
            return items[idx];
        }
        return null;
    },

    delete(key, id) {
        const items = this.getAll(key).filter(item => item.id !== id);
        localStorage.setItem(key, JSON.stringify(items));
        this._autoSync(); // Auto-sync on data change
    },

    // Auth
    login(email, password) {
        const users = this.getAll(this.USERS);
        const user = users.find(u => u.email === email && u.password === password);
        if (!user) return { success: false, message: 'Invalid email or password' };
        if (user.status === 'pending') return { success: false, message: 'Your account is pending approval. Please wait for admin confirmation.' };
        if (user.status === 'rejected') return { success: false, message: 'Your registration has been rejected. Contact admin.' };
        localStorage.setItem(this.SESSION, JSON.stringify({ userId: user.id, role: user.role, loginTime: new Date().toISOString() }));
        return { success: true, user };
    },

    getSession() {
        const session = JSON.parse(localStorage.getItem(this.SESSION));
        if (!session) return null;
        return { ...session, user: this.getById(this.USERS, session.userId) };
    },

    logout() {
        localStorage.removeItem(this.SESSION);
    },

    // Register new employee
    register(data) {
        const users = this.getAll(this.USERS);
        if (users.find(u => u.email === data.email)) {
            return { success: false, message: 'Email already registered' };
        }
        const id = this.nextId('user');
        const employeeId = this.nextEmployeeId();
        const user = {
            id,
            employeeId,
            name: data.name,
            email: data.email,
            phone: data.phone || '',
            password: data.password,
            role: 'employee',
            status: 'pending',
            photo: data.photo || '',
            address: data.address || '',
            aadhar: data.aadhar || '',
            pan: data.pan || '',
            bankName: data.bankName || '',
            bankAccount: data.bankAccount || '',
            ifsc: data.ifsc || '',
            designation: data.designation || '',
            department: data.department || '',
            joinDate: new Date().toISOString().split('T')[0],
            createdAt: new Date().toISOString()
        };
        this.add(this.USERS, user);

        // Create approval request
        const approvalId = this.nextId('approval');
        this.add(this.APPROVALS, {
            id: approvalId,
            type: 'registration',
            requestedBy: id,
            requestedByName: data.name,
            description: `New associate registration: ${data.name} (${data.email})`,
            data: user,
            status: 'pending',
            createdAt: new Date().toISOString()
        });

        // Notify admin
        this.addNotification('USR001', `New registration request from ${data.name}`, 'registration');

        // Send real email to admin
        const admin = this.getById(this.USERS, 'USR001');
        if (admin && admin.email) {
            this.sendEmail(admin.email, admin.name, 
                'New Registration Request',
                `A new associate has requested registration:<br><br><strong>Name:</strong> ${data.name}<br><strong>Email:</strong> ${data.email}<br><strong>Employee ID:</strong> ${employeeId}<br><br>Please review this request in your admin panel.`
            );
        }

        return { success: true, message: `Registration submitted! Your Employee ID: ${employeeId}. Awaiting admin approval.`, employeeId };
    },

    // Leads
    createLead(data) {
        const id = this.nextId('lead');
        const lead = {
            id,
            clientName: data.clientName,
            clientPhone: data.clientPhone || '',
            clientEmail: data.clientEmail || '',
            service: data.service,
            serviceType: data.serviceType || '',
            charges: parseFloat(data.charges) || 0,
            payout: parseFloat(data.payout) || 0,
            assignedTo: data.assignedTo || '',
            assignedToName: data.assignedToName || '',
            status: data.status || 'pending',
            notes: data.notes || '',
            createdBy: data.createdBy || '',
            approvalStatus: data.createdBy && data.createdBy !== 'USR001' ? 'pending' : 'approved',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        this.add(this.LEADS, lead);

        if (data.createdBy && data.createdBy !== 'USR001') {
            const approvalId = this.nextId('approval');
            const user = this.getById(this.USERS, data.createdBy);
            this.add(this.APPROVALS, {
                id: approvalId,
                type: 'lead_update',
                requestedBy: data.createdBy,
                requestedByName: user ? user.name : 'Employee',
                description: `New lead added: ${data.clientName} - ${data.service}`,
                data: { leadId: id, action: 'create', ...lead },
                status: 'pending',
                createdAt: new Date().toISOString()
            });
            this.addNotification('USR001', `${user?.name} added a new lead: ${data.clientName}`, 'lead');
        }

        // Send email to assigned employee
        if (data.assignedTo) {
            const assignee = this.getById(this.USERS, data.assignedTo);
            if (assignee && assignee.email) {
                this.sendEmail(assignee.email, assignee.name,
                    'New Lead Assigned',
                    `A new lead has been assigned to you:<br><br><strong>Client:</strong> ${data.clientName}<br><strong>Service:</strong> ${data.service}<br><strong>Payout:</strong> ₹${lead.payout.toLocaleString()}<br><br>Please check your dashboard for more details.`
                );
            }
        }

        return lead;
    },

    updateLeadStatus(leadId, status, updatedBy) {
        const lead = this.getById(this.LEADS, leadId);
        if (!lead) return null;

        // Employee can directly update lead status (no approval needed)
        this.update(this.LEADS, leadId, { status });

        if (updatedBy && updatedBy !== 'USR001') {
            // Employee updated — notify admin about the change
            const user = this.getById(this.USERS, updatedBy);
            this.addNotification('USR001', `${user?.name} updated lead "${lead.clientName}" to ${status}`, 'lead');
        } else {
            // Admin updated — notify assigned employee
            if (lead.assignedTo) {
                this.addNotification(lead.assignedTo, `Lead "${lead.clientName}" status updated to ${status}`, 'lead');
                const assignee = this.getById(this.USERS, lead.assignedTo);
                if (assignee && assignee.email) {
                    this.sendEmail(assignee.email, assignee.name,
                        `Lead Update: ${lead.clientName}`,
                        `The status of lead "<strong>${lead.clientName}</strong>" has been updated to "<strong>${status}</strong>" by admin.`
                    );
                }
            }
        }
        return { pending: false, message: 'Status updated successfully' };
    },

    // Invoices
    createInvoice(data) {
        const id = this.nextId('invoice');
        const count = this.getAll(this.INVOICES).length;
        const invoice = {
            id,
            invoiceNumber: `RIG-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`,
            type: data.type || 'client',
            leadId: data.leadId || '',
            clientName: data.clientName || '',
            employeeName: data.employeeName || '',
            employeeId: data.employeeId || '',
            service: data.service || '',
            amount: parseFloat(data.amount) || 0,
            gst: parseFloat(data.gst) || 0,
            totalAmount: parseFloat(data.totalAmount) || parseFloat(data.amount) || 0,
            from: data.from || 'Raj Indra Group',
            to: data.to || '',
            date: data.date || new Date().toISOString().split('T')[0],
            dueDate: data.dueDate || '',
            status: data.status || 'pending',
            notes: data.notes || '',
            createdBy: data.createdBy || '',
            createdAt: new Date().toISOString()
        };
        this.add(this.INVOICES, invoice);

        if (data.createdBy && data.createdBy !== 'USR001') {
            const approvalId = this.nextId('approval');
            const user = this.getById(this.USERS, data.createdBy);
            this.add(this.APPROVALS, {
                id: approvalId,
                type: 'invoice',
                requestedBy: data.createdBy,
                requestedByName: user ? user.name : 'Employee',
                description: `Invoice created: ${invoice.invoiceNumber} - ₹${invoice.amount}`,
                data: { invoiceId: id, ...invoice },
                status: 'pending',
                createdAt: new Date().toISOString()
            });
            this.addNotification('USR001', `${user?.name} created invoice ${invoice.invoiceNumber}`, 'invoice');
        }

        return invoice;
    },

    // Approvals
    processApproval(approvalId, action) {
        const approval = this.getById(this.APPROVALS, approvalId);
        if (!approval) return;

        this.update(this.APPROVALS, approvalId, { status: action, processedAt: new Date().toISOString() });

        // Get the user who requested
        const requestUser = this.getById(this.USERS, approval.requestedBy);
        const userName = requestUser ? requestUser.name : approval.requestedByName;
        const userEmail = requestUser ? requestUser.email : null;

        if (approval.type === 'registration') {
            this.update(this.USERS, approval.requestedBy, { status: action === 'approved' ? 'approved' : 'rejected' });
            this.addNotification(approval.requestedBy, `Your registration has been ${action}.`, 'registration');
            if (userEmail) {
                this.sendEmail(userEmail, userName,
                    `Registration ${action.charAt(0).toUpperCase() + action.slice(1)}`,
                    `Dear ${userName},<br><br>Your registration with <strong>Raj Indra Group</strong> has been <strong>${action}</strong>.<br><br>${action === 'approved' ? 'You can now login to the employee portal with your registered credentials.' : 'Please contact the admin for further assistance.'}`
                );
            }
        } else if (approval.type === 'lead_update') {
            if (action === 'approved' && approval.data.newStatus) {
                this.update(this.LEADS, approval.data.leadId, { status: approval.data.newStatus, approvalStatus: 'approved' });
            } else if (action === 'approved' && approval.data.action === 'create') {
                this.update(this.LEADS, approval.data.leadId, { approvalStatus: 'approved' });
            }
            this.addNotification(approval.requestedBy, `Your lead update has been ${action}.`, 'lead');
            if (userEmail) {
                this.sendEmail(userEmail, userName,
                    `Lead Update ${action.charAt(0).toUpperCase() + action.slice(1)}`,
                    `Your lead update request has been <strong>${action}</strong> by admin.`
                );
            }
        } else if (approval.type === 'invoice') {
            if (action === 'approved') {
                this.update(this.INVOICES, approval.data.invoiceId, { status: 'approved' });
            }
            this.addNotification(approval.requestedBy, `Your invoice has been ${action}.`, 'invoice');
            if (userEmail) {
                this.sendEmail(userEmail, userName,
                    `Invoice ${action.charAt(0).toUpperCase() + action.slice(1)}`,
                    `Your invoice <strong>${approval.data.invoiceNumber || ''}</strong> has been <strong>${action}</strong> by admin.`
                );
            }
        } else if (approval.type === 'profile_update') {
            if (action === 'approved') {
                this.update(this.USERS, approval.requestedBy, approval.data.updates);
            }
            this.addNotification(approval.requestedBy, `Your profile update has been ${action}.`, 'profile');
            if (userEmail) {
                this.sendEmail(userEmail, userName,
                    `Profile Update ${action.charAt(0).toUpperCase() + action.slice(1)}`,
                    `Your profile update request has been <strong>${action}</strong> by admin.`
                );
            }
        }
    },

    // Notifications
    addNotification(userId, message, type) {
        const notifs = this.getAll(this.NOTIFICATIONS);
        notifs.push({
            id: Date.now().toString(),
            userId,
            message,
            type,
            read: false,
            createdAt: new Date().toISOString()
        });
        localStorage.setItem(this.NOTIFICATIONS, JSON.stringify(notifs));
    },

    getNotifications(userId) {
        return this.getAll(this.NOTIFICATIONS).filter(n => n.userId === userId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },

    markNotificationRead(notifId) {
        const notifs = this.getAll(this.NOTIFICATIONS);
        const idx = notifs.findIndex(n => n.id === notifId);
        if (idx > -1) { notifs[idx].read = true; localStorage.setItem(this.NOTIFICATIONS, JSON.stringify(notifs)); }
    },

    getUnreadCount(userId) {
        return this.getNotifications(userId).filter(n => !n.read).length;
    },

    // Legacy email simulation (kept for backward compatibility)
    simulateEmail(userId, subject, body) {
        const user = this.getById(this.USERS, userId);
        if (!user) return;
        // Now sends real email if Google Sheets URL is configured
        this.sendEmail(user.email, user.name, subject, body);
    },

    // Financial calculations
    getFinancials(employeeId) {
        const leads = this.getAll(this.LEADS);
        const filtered = employeeId ? leads.filter(l => l.assignedTo === employeeId) : leads;
        const successful = filtered.filter(l => l.status === 'successful');
        const totalRevenue = successful.reduce((s, l) => s + l.charges, 0);
        const totalPayout = successful.reduce((s, l) => s + l.payout, 0);
        const netProfit = totalRevenue - totalPayout;
        const pending = filtered.filter(l => l.status === 'pending').length;
        const inProgress = filtered.filter(l => l.status === 'in-progress').length;
        const denied = filtered.filter(l => l.status === 'denied').length;

        return { totalRevenue, totalPayout, netProfit, totalLeads: filtered.length, successful: successful.length, pending, inProgress, denied };
    },

    // Export
    exportCSV(key, filename) {
        const data = this.getAll(key);
        if (!data.length) return;
        const headers = Object.keys(data[0]).filter(h => h !== 'photo' && h !== 'password');
        const csv = [headers.join(','), ...data.map(row => headers.map(h => `"${(row[h] || '').toString().replace(/"/g, '""')}"`).join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename || `${key}_export.csv`;
        a.click();
    },

    exportJSON(key, filename) {
        const data = this.getAll(key);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename || `${key}_export.json`;
        a.click();
    }
};

// Initialize on load
DB.init();
