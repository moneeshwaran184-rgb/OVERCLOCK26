/**
 * CampusOps Notifications Controller
 * Reads server-generated notifications from campusops_notifications
 * and marks them as read via campusops_read_notification.
 */

const Notifications = {
  notifications: [],

  async loadData() {
    const user = await API.getCurrentUser();
    if (!user) return;

    try {
      const data = await API.getNotifications(user.id);
      this.notifications = data || [];
      this.render();
      this.updateBadge();
    } catch (err) {
      console.error('Failed to load notifications:', err);
    }
  },

  updateBadge() {
    const badge = document.getElementById('unreadNotificationsBadge');
    if (!badge) return;

    const unreadCount = this.notifications.filter(n => !n.read_at).length;
    if (unreadCount > 0) {
      badge.textContent = unreadCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  },

  render() {
    const container = document.getElementById('notificationsListContainer');
    if (!container) return;

    if (this.notifications.length === 0) {
      container.innerHTML = `
        <div class="py-16 text-center text-slate-500 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <i data-lucide="bell" class="w-8 h-8 mx-auto mb-2 text-slate-400"></i>
          <h4 class="font-bold text-slate-900 dark:text-white text-base">All Caught Up</h4>
          <p class="text-xs text-slate-500 mt-1">You have no new notifications.</p>
        </div>`;
      if (window.App) window.App.refreshIcons();
      return;
    }

    container.innerHTML = this.notifications.map(n => {
      const isUnread = !n.read_at;

      return `
        <div class="bg-white dark:bg-slate-800 rounded-2xl border ${isUnread ? 'border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/20' : 'border-slate-200 dark:border-slate-700'} p-4 shadow-sm hover:shadow-md transition flex items-start justify-between gap-3">
          <div class="flex items-start gap-3">
            <div class="w-9 h-9 rounded-xl ${isUnread ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'} flex items-center justify-center shrink-0">
              <i data-lucide="${this.getIconForKind(n.kind)}" class="w-4 h-4"></i>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h4 class="font-bold text-slate-900 dark:text-white text-sm">${this.escapeHtml(n.title)}</h4>
                ${isUnread ? '<span class="w-2 h-2 rounded-full bg-indigo-600"></span>' : ''}
              </div>
              <p class="text-xs text-slate-600 dark:text-slate-300 mt-0.5">${this.escapeHtml(n.body)}</p>
              <span class="text-[11px] text-slate-400 font-mono mt-1 block">${new Date(n.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
            </div>
          </div>

          ${isUnread ? `
            <button onclick="Notifications.markRead('${n.id}')" class="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-semibold shrink-0 transition" title="Mark as Read">
              Mark Read
            </button>
          ` : ''}
        </div>
      `;
    }).join('');

    if (window.App) window.App.refreshIcons();
  },

  async markRead(notificationId) {
    try {
      await API.readNotification(notificationId);
      await this.loadData();
    } catch (err) {
      console.error('Mark read failed:', err);
    }
  },

  getIconForKind(kind) {
    switch (kind) {
      case 'work': return 'wrench';
      case 'approval': return 'file-check';
      case 'booking': return 'calendar';
      case 'report': return 'alert-circle';
      case 'stock': return 'package-alert';
      default: return 'bell';
    }
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
};

window.Notifications = Notifications;
