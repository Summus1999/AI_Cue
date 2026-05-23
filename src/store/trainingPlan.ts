import { create } from 'zustand';
import type { TrainingPlan } from '../services/trainingPlan';
import { generateTrainingPlan, getDayProgress } from '../services/trainingPlan';

interface TrainingPlanState {
  plan: TrainingPlan | null;
  isLoading: boolean;
  error: string | null;

  createPlan: (targetPosition: string, targetCompany: string) => void;
  loadPlan: () => void;
  deletePlan: () => void;
  toggleTask: (dayNumber: number, taskId: string) => void;
  getDayProgress: (dayNumber: number) => { completed: number; total: number };
  getTotalProgress: () => { completed: number; total: number };
  clearError: () => void;
}

const STORAGE_KEY = 'ai-cue-training-plan';

function loadFromStorage(): TrainingPlan | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveToStorage(plan: TrainingPlan | null): void {
  try {
    if (plan) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch (err) {
    console.error('Failed to save training plan:', err);
  }
}

export const useTrainingPlanStore = create<TrainingPlanState>((set, get) => ({
  plan: null,
  isLoading: false,
  error: null,

  createPlan: (targetPosition: string, targetCompany: string) => {
    const plan = generateTrainingPlan(targetPosition, targetCompany);
    saveToStorage(plan);
    set({ plan, error: null });
  },

  loadPlan: () => {
    const plan = loadFromStorage();
    set({ plan, isLoading: false });
  },

  deletePlan: () => {
    saveToStorage(null);
    set({ plan: null, error: null });
  },

  toggleTask: (dayNumber: number, taskId: string) => {
    const { plan } = get();
    if (!plan) return;

    const updatedDays = plan.days.map((day) => {
      if (day.dayNumber !== dayNumber) return day;

      const updatedTasks = day.tasks.map((task) => {
        if (task.id !== taskId) return task;
        const nowCompleted = !task.completed;
        return {
          ...task,
          completed: nowCompleted,
          completedAt: nowCompleted ? Date.now() : null,
        };
      });

      return { ...day, tasks: updatedTasks };
    });

    const updatedPlan = { ...plan, days: updatedDays };
    saveToStorage(updatedPlan);
    set({ plan: updatedPlan });
  },

  getDayProgress: (dayNumber: number) => {
    const { plan } = get();
    if (!plan) return { completed: 0, total: 0 };

    const day = plan.days.find((d) => d.dayNumber === dayNumber);
    if (!day) return { completed: 0, total: 0 };

    return getDayProgress(day);
  },

  getTotalProgress: () => {
    const { plan } = get();
    if (!plan) return { completed: 0, total: 0 };

    const total = plan.days.reduce((sum, d) => sum + d.tasks.length, 0);
    const completed = plan.days.reduce(
      (sum, d) => sum + d.tasks.filter((t) => t.completed).length,
      0,
    );
    return { completed, total };
  },

  clearError: () => set({ error: null }),
}));
