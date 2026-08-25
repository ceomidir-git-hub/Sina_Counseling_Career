import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Action = "clear_mail_and_auth" | "delete_employee_and_auth";

type RequestBody = {
  action?: Action;
  employee_id?: string;
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "POST 요청만 허용됩니다." });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) {
      return json(500, { ok: false, error: "Edge Function 환경변수가 설정되지 않았습니다." });
    }

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) {
      return json(401, { ok: false, error: "로그인 인증정보가 없습니다." });
    }

    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const action = body.action;
    const employeeId = String(body.employee_id || "").trim();

    if (!action || !["clear_mail_and_auth", "delete_employee_and_auth"].includes(action)) {
      return json(400, { ok: false, error: "지원하지 않는 작업입니다." });
    }
    if (!employeeId) {
      return json(400, { ok: false, error: "employee_id가 필요합니다." });
    }

    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    const caller = userData?.user;
    if (userError || !caller) {
      return json(401, { ok: false, error: "로그인 세션을 확인할 수 없습니다." });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: callerEmployee, error: callerError } = await admin
      .from("employee")
      .select("id,employee_code,name,permission,active,auth_user_id")
      .eq("auth_user_id", caller.id)
      .maybeSingle();

    if (callerError) {
      return json(500, { ok: false, error: `관리자 권한 확인 실패: ${callerError.message}` });
    }
    if (!callerEmployee || callerEmployee.active !== true || callerEmployee.permission !== "관리자") {
      return json(403, { ok: false, error: "관리자만 사용자/Auth 정보를 변경할 수 있습니다." });
    }

    const { data: target, error: targetError } = await admin
      .from("employee")
      .select("id,employee_code,name,email,auth_user_id,permission,active")
      .eq("id", employeeId)
      .maybeSingle();

    if (targetError) {
      return json(500, { ok: false, error: `대상 사용자 조회 실패: ${targetError.message}` });
    }
    if (!target) {
      return json(404, { ok: false, error: "대상 사용자를 찾을 수 없습니다." });
    }

    if (target.auth_user_id && target.auth_user_id === caller.id) {
      return json(409, {
        ok: false,
        error: "현재 로그인 중인 관리자 본인의 Auth 계정은 이 화면에서 삭제할 수 없습니다. 다른 관리자 계정으로 처리해 주세요.",
      });
    }

    const originalAuthUserId = target.auth_user_id as string | null;
    const originalEmail = target.email as string | null;

    if (action === "clear_mail_and_auth") {
      // 먼저 employee 연결을 해제해 FK 충돌 가능성을 줄인다.
      const { error: unlinkError } = await admin
        .from("employee")
        .update({ auth_user_id: null, email: null, updated_at: new Date().toISOString() })
        .eq("id", target.id);

      if (unlinkError) {
        return json(500, { ok: false, error: `메일/Auth 연결 해제 실패: ${unlinkError.message}` });
      }

      if (originalAuthUserId) {
        const { error: deleteAuthError } = await admin.auth.admin.deleteUser(originalAuthUserId);
        if (deleteAuthError) {
          // Auth 삭제가 실패하면 employee 값을 가능한 범위에서 원복한다.
          await admin
            .from("employee")
            .update({
              auth_user_id: originalAuthUserId,
              email: originalEmail,
              updated_at: new Date().toISOString(),
            })
            .eq("id", target.id);

          return json(500, {
            ok: false,
            error: `Auth 로그인 계정 삭제 실패: ${deleteAuthError.message}`,
          });
        }
      }

      return json(200, {
        ok: true,
        message: originalAuthUserId
          ? "메일 주소와 Auth 로그인 계정을 함께 삭제했습니다. 해당 사용자는 더 이상 로그인할 수 없습니다."
          : "메일 주소를 삭제했습니다. 연결된 Auth 로그인 계정은 없었습니다.",
      });
    }

    // delete_employee_and_auth
    if (originalAuthUserId) {
      const { error: unlinkError } = await admin
        .from("employee")
        .update({ auth_user_id: null, updated_at: new Date().toISOString() })
        .eq("id", target.id);

      if (unlinkError) {
        return json(500, { ok: false, error: `Auth 연결 해제 실패: ${unlinkError.message}` });
      }

      const { error: deleteAuthError } = await admin.auth.admin.deleteUser(originalAuthUserId);
      if (deleteAuthError) {
        await admin
          .from("employee")
          .update({ auth_user_id: originalAuthUserId, updated_at: new Date().toISOString() })
          .eq("id", target.id);

        return json(500, {
          ok: false,
          error: `Auth 로그인 계정 삭제 실패: ${deleteAuthError.message}`,
        });
      }
    }

    const { error: deleteEmployeeError } = await admin
      .from("employee")
      .delete()
      .eq("id", target.id);

    if (deleteEmployeeError) {
      return json(500, {
        ok: false,
        error: originalAuthUserId
          ? `Auth 계정은 삭제되었지만 employee 삭제에 실패했습니다: ${deleteEmployeeError.message}`
          : `employee 삭제 실패: ${deleteEmployeeError.message}`,
      });
    }

    return json(200, {
      ok: true,
      message: originalAuthUserId
        ? "사용자 정보와 Auth 로그인 계정을 모두 삭제했습니다. 해당 사용자는 더 이상 로그인할 수 없습니다."
        : "사용자 정보를 삭제했습니다. 연결된 Auth 로그인 계정은 없었습니다.",
    });
  } catch (error) {
    console.error(error);
    return json(500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
