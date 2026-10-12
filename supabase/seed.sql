-- =============================================================================
-- LOCAL DEVELOPMENT SEED ONLY. Loaded by `supabase db reset` on the local
-- stack. Never run against a hosted project (`supabase db push` does not apply
-- this file).
--
-- Test accounts (password for all: LocalDev-Password-1):
--   superadmin@example.test  SUPER_ADMIN
--   admin@example.test       ADMIN (may create projects)
--   admin2@example.test      ADMIN
--   individual@example.test  INDIVIDUAL
--   inactive@example.test    INDIVIDUAL, deactivated
-- =============================================================================

do $$
declare
  v_users jsonb := '[
    {"id":"00000000-0000-4000-8000-000000000001","email":"superadmin@example.test","name":"Sam Super"},
    {"id":"00000000-0000-4000-8000-000000000002","email":"admin@example.test","name":"Alex Admin"},
    {"id":"00000000-0000-4000-8000-000000000003","email":"individual@example.test","name":"Ivy Individual"},
    {"id":"00000000-0000-4000-8000-000000000004","email":"inactive@example.test","name":"Ian Inactive"},
    {"id":"00000000-0000-4000-8000-000000000005","email":"admin2@example.test","name":"Blair Admin"}
  ]';
  v_user jsonb;
begin
  for v_user in select * from jsonb_array_elements(v_users)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      (v_user ->> 'id')::uuid,
      'authenticated', 'authenticated',
      v_user ->> 'email',
      extensions.crypt('LocalDev-Password-1', extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', v_user ->> 'name'),
      now(), now(),
      '', '', '', '', '', '', '', ''
    );

    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(),
      (v_user ->> 'id')::uuid,
      v_user ->> 'id',
      jsonb_build_object('sub', v_user ->> 'id', 'email', v_user ->> 'email', 'email_verified', true),
      'email', now(), now(), now()
    );
  end loop;
end;
$$;

-- Profiles were created by the auth trigger; assign roles (no JWT here, so the
-- profile guard trigger treats this as a trusted call).
update public.profiles set role = 'SUPER_ADMIN' where id = '00000000-0000-4000-8000-000000000001';
update public.profiles set role = 'ADMIN'       where id in ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000005');
update public.profiles set is_active = false    where id = '00000000-0000-4000-8000-000000000004';

insert into public.workspaces (id, name, description, created_by)
values ('00000000-0000-4000-8000-0000000000a1', 'Demo Workspace', 'Local development workspace',
        '00000000-0000-4000-8000-000000000001');

insert into public.workspace_members (workspace_id, user_id, can_create_projects) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000002', true),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000003', false),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000004', false),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000005', false);
