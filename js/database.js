/* ========================================
   Raj Indra Group — Database Layer v2.0
   LocalStorage + Google Sheets Integration
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
    SHEETS_URL: '', // Will be set from config

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

    // Sync data to Google Sheets (via Apps Script Web App)
    async syncToSheets(sheetName, data) {
        if (!this.SHEETS_URL) return { success: false, message: 'Google Sheets URL not configured' };
        try {
            const response = await fetch(this.SHEETS_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'sync', sheet: sheetName, data: data })
            });
            return { success: true, message: 'Synced to Google Sheets' };
        } catch (err) {
            console.error('Sheets sync error:', err);
            return { success: false, message: 'Sync failed: ' + err.message };
        }
    },

    async syncAllToSheets() {
        if (!this.SHEETS_URL) return { success: false, message: 'Google Sheets URL not configured' };
        try {
            const allData = {
                action: 'syncAll',
                employees: this.getAll(this.USERS).map(u => {
                    const { password, ...safe } = u;
                    return safe;
                }),
                leads: this.getAll(this.LEADS),
                invoices: this.getAll(this.INVOICES),
                approvals: this.getAll(this.APPROVALS)
            };
            await fetch(this.SHEETS_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(allData)
            });
            return { success: true, message: 'All data synced to Google Sheets!' };
        } catch (err) {
            console.error('Full sync error:', err);
            return { success: false, message: 'Full sync failed: ' + err.message };
        }
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
        // Generate unique sequential employee ID
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
    // Compress and store photo as base64
    async processPhoto(file) {
        return new Promise((resolve, reject) => {
            if (!file) { resolve(''); return; }
            
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const MAX_SIZE = 300; // Max width/height for compressed photo
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
                    
                    // Convert to JPEG with 70% quality for smaller size
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
        return item;
    },

    update(key, id, updates) {
        const items = this.getAll(key);
        const idx = items.findIndex(item => item.id === id);
        if (idx > -1) {
            items[idx] = { ...items[idx], ...updates, updatedAt: new Date().toISOString() };
            localStorage.setItem(key, JSON.stringify(items));
            return items[idx];
        }
        return null;
    },

    delete(key, id) {
        const items = this.getAll(key).filter(item => item.id !== id);
        localStorage.setItem(key, JSON.stringify(items));
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

        // Auto sync to sheets
        this.syncToSheets('Employees', user);

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

        // Auto sync to sheets
        this.syncToSheets('Leads', lead);

        return lead;
    },

    updateLeadStatus(leadId, status, updatedBy) {
        const lead = this.getById(this.LEADS, leadId);
        if (!lead) return null;

        if (updatedBy && updatedBy !== 'USR001') {
            const approvalId = this.nextId('approval');
            const user = this.getById(this.USERS, updatedBy);
            this.add(this.APPROVALS, {
                id: approvalId,
                type: 'lead_update',
                requestedBy: updatedBy,
                requestedByName: user ? user.name : 'Employee',
                description: `Lead status update: ${lead.clientName} → ${status}`,
                data: { leadId, oldStatus: lead.status, newStatus: status },
                status: 'pending',
                createdAt: new Date().toISOString()
            });
            this.addNotification('USR001', `${user?.name} requests to update lead "${lead.clientName}" to ${status}`, 'lead');
            return { pending: true, message: 'Status update sent for admin approval' };
        } else {
            this.update(this.LEADS, leadId, { status });
            if (lead.assignedTo) {
                this.addNotification(lead.assignedTo, `Lead "${lead.clientName}" status updated to ${status}`, 'lead');
                this.simulateEmail(lead.assignedTo, `Lead Update: ${lead.clientName}`, `The status of lead "${lead.clientName}" has been updated to "${status}" by admin.`);
            }
            return { pending: false, message: 'Status updated successfully' };
        }
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

        if (approval.type === 'registration') {
            this.update(this.USERS, approval.requestedBy, { status: action === 'approved' ? 'approved' : 'rejected' });
            this.addNotification(approval.requestedBy, `Your registration has been ${action}.`, 'registration');
            this.simulateEmail(approval.requestedBy, `Registration ${action}`, `Dear ${approval.requestedByName}, your registration with Raj Indra Group has been ${action}.`);
        } else if (approval.type === 'lead_update') {
            if (action === 'approved' && approval.data.newStatus) {
                this.update(this.LEADS, approval.data.leadId, { status: approval.data.newStatus, approvalStatus: 'approved' });
            } else if (action === 'approved' && approval.data.action === 'create') {
                this.update(this.LEADS, approval.data.leadId, { approvalStatus: 'approved' });
            }
            this.addNotification(approval.requestedBy, `Your lead update has been ${action}.`, 'lead');
            this.simulateEmail(approval.requestedBy, `Lead Update ${action}`, `Your lead update request has been ${action} by admin.`);
        } else if (approval.type === 'invoice') {
            if (action === 'approved') {
                this.update(this.INVOICES, approval.data.invoiceId, { status: 'approved' });
            }
            this.addNotification(approval.requestedBy, `Your invoice has been ${action}.`, 'invoice');
            this.simulateEmail(approval.requestedBy, `Invoice ${action}`, `Your invoice ${approval.data.invoiceNumber} has been ${action} by admin.`);
        } else if (approval.type === 'profile_update') {
            if (action === 'approved') {
                this.update(this.USERS, approval.requestedBy, approval.data.updates);
            }
            this.addNotification(approval.requestedBy, `Your profile update has been ${action}.`, 'profile');
            this.simulateEmail(approval.requestedBy, `Profile Update ${action}`, `Your profile update request has been ${action} by admin.`);
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

    // Email Simulation
    simulateEmail(userId, subject, body) {
        const user = this.getById(this.USERS, userId);
        if (!user) return;
        console.log(`📧 EMAIL SENT to ${user.email}:\nSubject: ${subject}\nBody: ${body}`);
        const emailLog = JSON.parse(localStorage.getItem('rig_emails') || '[]');
        emailLog.push({ to: user.email, toName: user.name, subject, body, sentAt: new Date().toISOString() });
        localStorage.setItem('rig_emails', JSON.stringify(emailLog));
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
        // Filter out photo data from exports (too large)
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
