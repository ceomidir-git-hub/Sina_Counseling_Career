/*
  main.html 및 로그인 이후 화면 공통 로그인 보호 스크립트
  사용 방법:
  1) main.html </body> 바로 위에 아래 2줄 추가
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="auth-guard.js"></script>

  2) 로그아웃 버튼에서 window.sinaLogout() 호출
*/

(() => {
  const SUPABASE_URL = "https://fafdxaifluftnertbpvr.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_RNEAVQD2wZRtZojxVU11aA_Dacmf7db";

  if (!window.supabase) {
    console.error("Supabase JS가 로드되지 않았습니다.");
    window.location.replace("index.html");
    return;
  }

  const client = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );

  window.sinaSupabase = client;

  async function guard() {
    try {
      const { data: { user }, error: userError } = await client.auth.getUser();

      if (userError || !user) {
        sessionStorage.removeItem("sina_employee");
        window.location.replace("index.html");
        return;
      }

      const { data: employee, error: employeeError } = await client
        .from("employee")
        .select("employee_code, position, name, email, permission, active")
        .eq("auth_user_id", user.id)
        .maybeSingle();

      if (employeeError || !employee || !employee.active) {
        await client.auth.signOut();
        sessionStorage.removeItem("sina_employee");
        window.location.replace("index.html");
        return;
      }

      sessionStorage.setItem("sina_employee", JSON.stringify(employee));

      window.dispatchEvent(
        new CustomEvent("sina-auth-ready", {
          detail: { user, employee }
        })
      );
    } catch (err) {
      console.error("로그인 보호 오류:", err);
      sessionStorage.removeItem("sina_employee");
      window.location.replace("index.html");
    }
  }

  window.sinaLogout = async function() {
    try {
      await client.auth.signOut();
    } finally {
      sessionStorage.removeItem("sina_employee");
      window.location.replace("index.html");
    }
  };

  guard();
})();
