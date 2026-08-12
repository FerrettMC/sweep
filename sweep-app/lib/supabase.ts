import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://qldyjqrtfuraxvhsslrz.supabase.co";
const supabaseAnonKey = "sb_publishable_Yt8O0ZIvcZ3tP7uoMHjybw_l4YOnZFF"; // the sb_publishable_... one from earlier

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
