// Deployment Planner Frontend JavaScript

let currentTeamId = null;
let currentDays = 14;
let outlookData = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    loadTeams();
    setupEventListeners();
});

function setupEventListeners() {
    const teamSelect = document.getElementById('team-select');
    const daysSelect = document.getElementById('days-select');
    const addDeploymentBtn = document.getElementById('add-deployment-btn');
    const statusSelect = document.getElementById('status');

    if (teamSelect) {
        teamSelect.addEventListener('change', handleTeamChange);
    }

    if (daysSelect) {
        daysSelect.addEventListener('change', handleDaysChange);
    }

    if (addDeploymentBtn) {
        addDeploymentBtn.addEventListener('click', openAddDeploymentModal);
    }

    if (statusSelect) {
        statusSelect.addEventListener('change', handleStatusChange);
    }

    // Form submission
    const form = document.getElementById('deployment-form');
    if (form) {
        form.addEventListener('submit', handleDeploymentSubmit);
    }
}

async function loadTeams() {
    try {
        const response = await fetch('/api/teams');
        if (!response.ok) {
            throw new Error('Failed to load teams');
        }

        const data = await response.json();
        const teamSelect = document.getElementById('team-select');

        if (!data.teams || data.teams.length === 0) {
            teamSelect.innerHTML = '<option value="">No teams available</option>';
            return;
        }

        teamSelect.innerHTML = '<option value="">Select a team...</option>' +
            data.teams.map(team => `<option value="${team.id}">${team.name}</option>`).join('');

        // Auto-select first team if available
        if (data.teams.length > 0) {
            teamSelect.value = data.teams[0].id;
            currentTeamId = data.teams[0].id;
            loadOutlook();
        }
    } catch (error) {
        console.error('Error loading teams:', error);
        showError('Failed to load teams. Please refresh the page.');
    }
}

function handleTeamChange(event) {
    currentTeamId = event.target.value;
    if (currentTeamId) {
        loadOutlook();
    }
}

function handleDaysChange(event) {
    currentDays = parseInt(event.target.value);
    if (currentTeamId) {
        loadOutlook();
    }
}

async function loadOutlook() {
    if (!currentTeamId) {
        return;
    }

    const loading = document.getElementById('loading');
    const calendarContainer = document.getElementById('calendar-container');
    const deploymentsContainer = document.getElementById('deployments-container');

    if (loading) loading.style.display = 'block';
    if (calendarContainer) calendarContainer.style.display = 'none';
    if (deploymentsContainer) deploymentsContainer.style.display = 'none';

    try {
        const response = await fetch(`/api/deployments/outlook?team_id=${currentTeamId}&days=${currentDays}`);
        if (!response.ok) {
            throw new Error('Failed to load outlook');
        }

        outlookData = await response.json();
        renderCalendar();
        renderDeployments();

        if (loading) loading.style.display = 'none';
        if (calendarContainer) calendarContainer.style.display = 'block';
        if (deploymentsContainer) deploymentsContainer.style.display = 'block';
    } catch (error) {
        console.error('Error loading outlook:', error);
        showError('Failed to load deployment outlook. Please try again.');
        if (loading) loading.style.display = 'none';
    }
}

function renderCalendar() {
    if (!outlookData || !outlookData.outlook) {
        return;
    }

    const calendarGrid = document.getElementById('calendar-grid');
    if (!calendarGrid) return;

    calendarGrid.innerHTML = outlookData.outlook.map(day => {
        const date = new Date(day.date + 'T00:00:00');
        const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'short' });
        const dayOfMonth = date.getDate();
        const month = date.toLocaleDateString('en-US', { month: 'short' });

        const riskClass = `risk-${day.risk_level}`;
        const riskBadgeClass = day.risk_level === 'unknown' ? 'unknown' : day.risk_level;

        const deploymentBadges = day.deployments && day.deployments.length > 0
            ? day.deployments.map(d => `
                <div class="deployment-badge" onclick="viewDeployment(${d.id})">
                    📦 ${d.service_name}
                </div>
            `).join('')
            : '';

        const riskFactorsHtml = day.risk_factors && day.risk_factors.length > 0
            ? `<div class="risk-factors">
                ${day.risk_factors.slice(0, 2).map(rf => `
                    <div>⚠️ ${rf.planet}: ${rf.level}</div>
                `).join('')}
            </div>`
            : '';

        return `
            <div class="calendar-day ${riskClass}" onclick="selectDate('${day.date}')">
                <div class="day-header">
                    <div class="day-date">${dayOfWeek} ${month} ${dayOfMonth}</div>
                    <div class="risk-badge ${riskBadgeClass}">${day.risk_level}</div>
                </div>
                ${deploymentBadges}
                ${riskFactorsHtml}
            </div>
        `;
    }).join('');
}

function renderDeployments() {
    if (!outlookData || !outlookData.outlook) {
        return;
    }

    const deploymentsList = document.getElementById('deployments-list');
    if (!deploymentsList) return;

    // Collect all deployments from all days
    const allDeployments = [];
    outlookData.outlook.forEach(day => {
        if (day.deployments && day.deployments.length > 0) {
            day.deployments.forEach(deployment => {
                allDeployments.push({
                    ...deployment,
                    risk_level: day.risk_level,
                    risk_factors: day.risk_factors,
                    recommendations: day.recommendations
                });
            });
        }
    });

    if (allDeployments.length === 0) {
        deploymentsList.innerHTML = '<p style="opacity: 0.7;">No deployments scheduled. Click "Add Deployment" to create one.</p>';
        return;
    }

    deploymentsList.innerHTML = allDeployments.map(deployment => {
        const date = new Date(deployment.planned_date + 'T00:00:00');
        const formattedDate = date.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        const riskBadgeClass = deployment.risk_level === 'unknown' ? 'unknown' : deployment.risk_level;

        const riskFactorsHtml = deployment.risk_factors && deployment.risk_factors.length > 0
            ? `<div class="deployment-risk-info">
                <strong>⚠️ Risk Factors:</strong>
                ${deployment.risk_factors.map(rf => `
                    <div style="margin-top: 8px;">
                        <strong>${rf.planet}:</strong> ${rf.message}
                    </div>
                `).join('')}
            </div>`
            : '';

        const recommendationsHtml = deployment.recommendations && deployment.recommendations.length > 0
            ? `<div class="risk-recommendation">
                <strong>💡 Recommendations:</strong>
                <ul style="margin-top: 8px; padding-left: 20px;">
                    ${deployment.recommendations.slice(0, 3).map(rec => `<li>${rec}</li>`).join('')}
                </ul>
            </div>`
            : '';

        return `
            <div class="deployment-card">
                <div class="deployment-header">
                    <div>
                        <div class="deployment-title">📦 ${deployment.service_name}</div>
                        <div class="deployment-date">${formattedDate}</div>
                        ${deployment.description ? `<p style="margin-top: 10px; opacity: 0.9;">${deployment.description}</p>` : ''}
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 10px;">
                        <div class="risk-badge ${riskBadgeClass}">${deployment.risk_level} risk</div>
                        <div class="deployment-actions">
                            <button onclick="editDeployment(${deployment.id})" style="background: #48dbfb; color: #1e3c72;">Edit</button>
                            <button onclick="deleteDeployment(${deployment.id})" style="background: #ff6b6b; color: white;">Delete</button>
                        </div>
                    </div>
                </div>
                ${riskFactorsHtml}
                ${recommendationsHtml}
            </div>
        `;
    }).join('');
}

function selectDate(date) {
    openAddDeploymentModal(date);
}

function openAddDeploymentModal(preselectedDate = null) {
    if (!currentTeamId) {
        showError('Please select a team first');
        return;
    }

    const modal = document.getElementById('deployment-modal');
    const form = document.getElementById('deployment-form');
    const modalTitle = document.getElementById('modal-title');

    if (modalTitle) modalTitle.textContent = 'Add Deployment';
    if (form) form.reset();

    const deploymentId = document.getElementById('deployment-id');
    if (deploymentId) deploymentId.value = '';

    // Pre-fill date if provided
    if (preselectedDate) {
        const plannedDate = document.getElementById('planned-date');
        if (plannedDate) plannedDate.value = preselectedDate;
    }

    // Hide outcome field for new deployments
    const outcomeGroup = document.getElementById('outcome-group');
    if (outcomeGroup) outcomeGroup.style.display = 'none';

    if (modal) modal.classList.add('active');
}

async function editDeployment(deploymentId) {
    try {
        const response = await fetch(`/api/deployments/${deploymentId}`);
        if (!response.ok) {
            throw new Error('Failed to load deployment');
        }

        const data = await response.json();
        const deployment = data.deployment;

        const modal = document.getElementById('deployment-modal');
        const modalTitle = document.getElementById('modal-title');

        if (modalTitle) modalTitle.textContent = 'Edit Deployment';

        document.getElementById('deployment-id').value = deployment.id;
        document.getElementById('service-name').value = deployment.service_name;
        document.getElementById('description').value = deployment.description || '';
        document.getElementById('planned-date').value = deployment.planned_date;
        document.getElementById('status').value = deployment.status;

        // Show outcome field if status is completed
        const outcomeGroup = document.getElementById('outcome-group');
        if (deployment.status === 'completed') {
            if (outcomeGroup) outcomeGroup.style.display = 'block';
            document.getElementById('outcome').value = deployment.outcome || '';
        } else {
            if (outcomeGroup) outcomeGroup.style.display = 'none';
        }

        if (modal) modal.classList.add('active');
    } catch (error) {
        console.error('Error loading deployment:', error);
        showError('Failed to load deployment details');
    }
}

async function viewDeployment(deploymentId) {
    editDeployment(deploymentId);
}

async function deleteDeployment(deploymentId) {
    if (!confirm('Are you sure you want to delete this deployment?')) {
        return;
    }

    try {
        const response = await fetch(`/api/deployments/${deploymentId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('Failed to delete deployment');
        }

        // Reload outlook
        await loadOutlook();
    } catch (error) {
        console.error('Error deleting deployment:', error);
        showError('Failed to delete deployment');
    }
}

async function handleDeploymentSubmit(event) {
    event.preventDefault();

    const deploymentId = document.getElementById('deployment-id').value;
    const serviceName = document.getElementById('service-name').value;
    const description = document.getElementById('description').value;
    const plannedDate = document.getElementById('planned-date').value;
    const status = document.getElementById('status').value;
    const outcome = document.getElementById('outcome').value;

    const data = {
        team_id: parseInt(currentTeamId),
        service_name: serviceName,
        description: description || null,
        planned_date: plannedDate,
        status: status
    };

    if (status === 'completed' && outcome) {
        data.outcome = outcome;
    }

    try {
        let response;
        if (deploymentId) {
            // Update existing deployment
            response = await fetch(`/api/deployments/${deploymentId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        } else {
            // Create new deployment
            response = await fetch('/api/deployments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        }

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to save deployment');
        }

        closeModal();
        await loadOutlook();
    } catch (error) {
        console.error('Error saving deployment:', error);
        showError(error.message || 'Failed to save deployment');
    }
}

function handleStatusChange(event) {
    const status = event.target.value;
    const outcomeGroup = document.getElementById('outcome-group');

    if (outcomeGroup) {
        if (status === 'completed') {
            outcomeGroup.style.display = 'block';
        } else {
            outcomeGroup.style.display = 'none';
            document.getElementById('outcome').value = '';
        }
    }
}

function closeModal() {
    const modal = document.getElementById('deployment-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

function showError(message) {
    const errorContainer = document.getElementById('error-container');
    if (!errorContainer) return;

    errorContainer.innerHTML = `
        <div class="error">
            <strong>Error:</strong> ${message}
        </div>
    `;

    // Auto-hide after 5 seconds
    setTimeout(() => {
        errorContainer.innerHTML = '';
    }, 5000);
}

// Close modal when clicking outside
window.addEventListener('click', (event) => {
    const modal = document.getElementById('deployment-modal');
    if (event.target === modal) {
        closeModal();
    }
});
