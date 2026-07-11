/**
 * app.js — 全局应用入口：侧边栏切换、工具导航
 */
(function () {
  'use strict';

  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('sidebarOverlay');
  var menuBtn = document.getElementById('menuBtn');
  var closeBtn = document.getElementById('sidebarClose');
  var mainContent = document.getElementById('mainContent');
  var toolItems = document.querySelectorAll('.tool-item');
  var pageTitle = document.getElementById('pageTitle');
  var isMobile = window.innerWidth <= 768;

  /* ===== 侧边栏开合 ===== */
  function toggleSidebar() {
    if (isMobile) {
      // 移动端：使用 open 类
      if (sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
        overlay.classList.remove('show');
      } else {
        sidebar.classList.add('open');
        overlay.classList.add('show');
      }
    } else {
      // 桌面端：使用 collapsed 类
      if (sidebar.classList.contains('collapsed')) {
        sidebar.classList.remove('collapsed');
        mainContent.classList.remove('sidebar-collapsed');
      } else {
        sidebar.classList.add('collapsed');
        mainContent.classList.add('sidebar-collapsed');
      }
    }
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
  }

  menuBtn.addEventListener('click', toggleSidebar);
  closeBtn.addEventListener('click', toggleSidebar);
  overlay.addEventListener('click', closeSidebar);

  // 窗口尺寸变化时更新模式
  window.addEventListener('resize', function () {
    isMobile = window.innerWidth <= 768;
    // 切换模式时清理类名
    if (isMobile) {
      sidebar.classList.remove('collapsed');
      mainContent.classList.remove('sidebar-collapsed');
    } else {
      sidebar.classList.remove('open');
      overlay.classList.remove('show');
    }
  });

  /* ===== 工具导航切换 ===== */
  toolItems.forEach(function (item) {
    item.addEventListener('click', function (e) {
      e.preventDefault();
      if (item.classList.contains('disabled')) return;
      toolItems.forEach(function (i) { i.classList.remove('active'); });
      item.classList.add('active');
      var toolName = item.querySelector('.tool-name').textContent;
      pageTitle.textContent = toolName;
      if (isMobile) closeSidebar();
    });
  });

  /* ===== 输入校验：失焦自动修正 ===== */
  document.querySelectorAll('.input-group input[type="number"]').forEach(function (input) {
    input.addEventListener('blur', function () {
      var val = parseFloat(input.value);
      if (isNaN(val) || val < 1) val = 1;
      if (val > 200) val = 200;
      input.value = Math.round(val * 10) / 10;
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') input.blur();
    });
  });
})();
