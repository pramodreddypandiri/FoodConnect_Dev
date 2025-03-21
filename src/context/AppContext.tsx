import React, { createContext, useContext, useReducer, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { User, UserRole } from '../types/user';
import type { FoodListing } from '../types/listing';
import type { Notification } from '../hooks/useNotifications';

// Define the state shape
interface AppState {
  user: User | null;
  listings: {
    active: FoodListing[];
    past: FoodListing[];
  };
  analytics: {
    totalDonations: number;
    mealsServed: number;
    co2Saved: number;
    categoryBreakdown: Record<string, number>;
    recentActivity: {
      donations: number[];
      dates: string[];
    };
    environmentalStats: {
      waterSaved: number;
      energySaved: number;
      wasteDiverted: number;
    };
  };
  notifications: Notification[];
}

// Define action types
type Action =
  | { type: 'SET_USER'; payload: User | null }
  | { type: 'ADD_LISTING'; payload: FoodListing }
  | { type: 'DELETE_LISTING'; payload: number }
  | { type: 'MARK_AS_CLAIMED'; payload: number }
  | { type: 'UPDATE_ANALYTICS'; payload: Partial<AppState['analytics']> }
  | { type: 'ADD_NOTIFICATION'; payload: Notification }
  | { type: 'REMOVE_NOTIFICATION'; payload: number }
  | { type: 'CLEAR_ALL_NOTIFICATIONS' };

const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<Action>;
} | null>(null);

const initialState: AppState = {
  user: null,
  listings: {
    active: [],
    past: [],
  },
  analytics: {
    totalDonations: 0,
    mealsServed: 0,
    co2Saved: 0,
    categoryBreakdown: {},
    recentActivity: {
      donations: [],
      dates: []
    },
    environmentalStats: {
      waterSaved: 0,
      energySaved: 0,
      wasteDiverted: 0
    }
  },
  notifications: []
};

function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_USER':
      return { ...state, user: action.payload };
    case 'ADD_LISTING':
      return {
        ...state,
        listings: {
          ...state.listings,
          active: [...state.listings.active, action.payload],
        },
      };
    case 'DELETE_LISTING':
      return {
        ...state,
        listings: {
          ...state.listings,
          active: state.listings.active.filter(listing => listing.id !== action.payload),
        },
      };
    case 'MARK_AS_CLAIMED':
      const listing = state.listings.active.find(l => l.id === action.payload);
      if (!listing) return state;
      return {
        ...state,
        listings: {
          active: state.listings.active.filter(l => l.id !== action.payload),
          past: [{ ...listing, expiresIn: 'Claimed' }, ...state.listings.past],
        },
      };
    case 'UPDATE_ANALYTICS':
      return {
        ...state,
        analytics: { ...state.analytics, ...action.payload },
      };
    case 'ADD_NOTIFICATION':
      return {
        ...state,
        notifications: [action.payload, ...state.notifications],
      };
    case 'REMOVE_NOTIFICATION':
      return {
        ...state,
        notifications: state.notifications.filter(n => n.id !== action.payload),
      };
    case 'CLEAR_ALL_NOTIFICATIONS':
      return {
        ...state,
        notifications: [],
      };
    default:
      return state;
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        try {
          // Wait a moment for the session to be fully established
          await new Promise(resolve => setTimeout(resolve, 500));

          // Fetch user profile with retries
          let retries = 3;
          let profile = null;
          let error = null;

          while (retries > 0 && !profile) {
            const { data, error: profileError } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', session.user.id)
              .single();

            if (data) {
              profile = data;
              break;
            }

            error = profileError;
            retries--;
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

          if (!profile && error) {
            // If profile still doesn't exist after retries, create it
            const { data: newProfile, error: createError } = await supabase
              .from('profiles')
              .insert([{
                id: session.user.id,
                full_name: session.user.user_metadata.full_name || 'User',
                role: session.user.user_metadata.role || 'recipient',
                avatar_url: session.user.user_metadata.avatar_url
              }])
              .select()
              .single();

            if (createError) throw createError;
            profile = newProfile;
          }

          if (profile) {
            dispatch({
              type: 'SET_USER',
              payload: {
                id: session.user.id,
                name: profile.full_name || 'User',
                role: profile.role,
                avatar: profile.avatar_url,
                notifications: 0
              }
            });
          }
        } catch (error) {
          console.error('Error fetching user profile:', error);
        }
      } else if (event === 'SIGNED_OUT') {
        dispatch({ type: 'SET_USER', payload: null });
      }
    });

    // Check for existing session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        try {
          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single();

          if (profileError) throw profileError;

          if (profile) {
            dispatch({
              type: 'SET_USER',
              payload: {
                id: session.user.id,
                name: profile.full_name || 'User',
                role: profile.role,
                avatar: profile.avatar_url,
                notifications: 0
              }
            });
          }
        } catch (error) {
          console.error('Error fetching user profile:', error);
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}