--
-- PostgreSQL database dump
--

-- Dumped from database version 14.14 (Homebrew)
-- Dumped by pg_dump version 14.14 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER TABLE IF EXISTS ONLY public.user_templates DROP CONSTRAINT IF EXISTS user_templates_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.user_settings DROP CONSTRAINT IF EXISTS user_settings_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.user_accounts DROP CONSTRAINT IF EXISTS user_accounts_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.trades DROP CONSTRAINT IF EXISTS trades_signal_sid_fkey;
ALTER TABLE IF EXISTS ONLY public.trades DROP CONSTRAINT IF EXISTS trades_account_id_fkey;
ALTER TABLE IF EXISTS ONLY public.logs DROP CONSTRAINT IF EXISTS logs_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.signals DROP CONSTRAINT IF EXISTS fk_signals_user;
ALTER TABLE IF EXISTS ONLY public.execution_profiles DROP CONSTRAINT IF EXISTS execution_profiles_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.accounts DROP CONSTRAINT IF EXISTS accounts_user_id_fkey;
DROP TRIGGER IF EXISTS trg_signals_sync_action_side ON public.signals;
DROP INDEX IF EXISTS public.uq_users_sid;
DROP INDEX IF EXISTS public.uq_users_id;
DROP INDEX IF EXISTS public.uq_trades_sid;
DROP INDEX IF EXISTS public.uq_trades_id;
DROP INDEX IF EXISTS public.uq_trades_account_signal;
DROP INDEX IF EXISTS public.uq_signals_sid;
DROP INDEX IF EXISTS public.uq_signals_id;
DROP INDEX IF EXISTS public.uq_accounts_sid;
DROP INDEX IF EXISTS public.uq_accounts_id;
DROP INDEX IF EXISTS public.uq_accounts_api_key_hash;
DROP INDEX IF EXISTS public.idx_trades_user;
DROP INDEX IF EXISTS public.idx_trades_symbol;
DROP INDEX IF EXISTS public.idx_trades_signal_sid;
DROP INDEX IF EXISTS public.idx_trades_signal_id;
DROP INDEX IF EXISTS public.idx_trades_sid;
DROP INDEX IF EXISTS public.idx_trades_exec_status;
DROP INDEX IF EXISTS public.idx_trades_dispatch_queue;
DROP INDEX IF EXISTS public.idx_trades_created_at;
DROP INDEX IF EXISTS public.idx_trades_broker_ticket;
DROP INDEX IF EXISTS public.idx_trades_account;
DROP INDEX IF EXISTS public.idx_signals_user_created;
DROP INDEX IF EXISTS public.idx_signals_user;
DROP INDEX IF EXISTS public.idx_signals_symbol;
DROP INDEX IF EXISTS public.idx_signals_status_created;
DROP INDEX IF EXISTS public.idx_signals_status;
DROP INDEX IF EXISTS public.idx_signals_sid;
DROP INDEX IF EXISTS public.idx_signals_created_at;
DROP INDEX IF EXISTS public.idx_market_data_symbol_tf_bar;
DROP INDEX IF EXISTS public.idx_logs_user;
DROP INDEX IF EXISTS public.idx_logs_trace;
DROP INDEX IF EXISTS public.idx_logs_symbol;
DROP INDEX IF EXISTS public.idx_logs_object_event_tsu;
DROP INDEX IF EXISTS public.idx_logs_object;
DROP INDEX IF EXISTS public.idx_logs_event_type;
DROP INDEX IF EXISTS public.idx_logs_created_at;
DROP INDEX IF EXISTS public.idx_accounts_user;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_pkey;
ALTER TABLE IF EXISTS ONLY public.user_templates DROP CONSTRAINT IF EXISTS user_templates_pkey;
ALTER TABLE IF EXISTS ONLY public.user_settings DROP CONSTRAINT IF EXISTS user_settings_user_type_name_key;
ALTER TABLE IF EXISTS ONLY public.user_settings DROP CONSTRAINT IF EXISTS user_settings_pkey;
ALTER TABLE IF EXISTS ONLY public.user_accounts DROP CONSTRAINT IF EXISTS user_accounts_pkey;
ALTER TABLE IF EXISTS ONLY public.trades DROP CONSTRAINT IF EXISTS trades_pkey;
ALTER TABLE IF EXISTS ONLY public.signals DROP CONSTRAINT IF EXISTS signals_pkey;
ALTER TABLE IF EXISTS ONLY public.market_data DROP CONSTRAINT IF EXISTS market_data_symbol_tf_range_key;
ALTER TABLE IF EXISTS ONLY public.market_data DROP CONSTRAINT IF EXISTS market_data_pkey;
ALTER TABLE IF EXISTS ONLY public.logs DROP CONSTRAINT IF EXISTS logs_pkey;
ALTER TABLE IF EXISTS ONLY public.execution_profiles DROP CONSTRAINT IF EXISTS execution_profiles_pkey;
ALTER TABLE IF EXISTS ONLY public.ea_logs DROP CONSTRAINT IF EXISTS ea_logs_pkey;
ALTER TABLE IF EXISTS ONLY public.accounts DROP CONSTRAINT IF EXISTS accounts_pkey;
ALTER TABLE IF EXISTS public.users ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.user_templates ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.trades ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.signals ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.market_data ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.logs ALTER COLUMN log_id DROP DEFAULT;
ALTER TABLE IF EXISTS public.ea_logs ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.accounts ALTER COLUMN id DROP DEFAULT;
DROP SEQUENCE IF EXISTS public.users_id_seq;
DROP TABLE IF EXISTS public.users;
DROP SEQUENCE IF EXISTS public.user_templates_id_seq;
DROP TABLE IF EXISTS public.user_templates;
DROP TABLE IF EXISTS public.user_settings;
DROP TABLE IF EXISTS public.user_accounts;
DROP SEQUENCE IF EXISTS public.trades_id_seq;
DROP TABLE IF EXISTS public.trades;
DROP SEQUENCE IF EXISTS public.signals_id_seq;
DROP TABLE IF EXISTS public.signals;
DROP SEQUENCE IF EXISTS public.market_data_id_seq;
DROP TABLE IF EXISTS public.market_data;
DROP SEQUENCE IF EXISTS public.logs_log_id_seq;
DROP TABLE IF EXISTS public.logs;
DROP TABLE IF EXISTS public.execution_profiles;
DROP SEQUENCE IF EXISTS public.ea_logs_id_seq;
DROP TABLE IF EXISTS public.ea_logs;
DROP SEQUENCE IF EXISTS public.accounts_id_seq;
DROP TABLE IF EXISTS public.accounts;
DROP FUNCTION IF EXISTS public.signals_sync_action_side();
DROP FUNCTION IF EXISTS public.gen_sid(prefix text, chars_limit integer);
DROP EXTENSION IF EXISTS pgcrypto;
--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: gen_sid(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gen_sid(prefix text DEFAULT ''::text, chars_limit integer DEFAULT 8) RETURNS text
    LANGUAGE plpgsql
    AS $$
    DECLARE
      p TEXT := UPPER(COALESCE(prefix, ''));
      n INT := GREATEST(4, LEAST(COALESCE(chars_limit, 8), 32));
      rnd TEXT;
    BEGIN
      rnd := UPPER(SUBSTRING(ENCODE(GEN_RANDOM_BYTES(24), 'hex') FROM 1 FOR n));
      IF p = '' THEN
        RETURN rnd;
      END IF;
      RETURN p || '_' || rnd;
    END;
    $$;


--
-- Name: signals_sync_action_side(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.signals_sync_action_side() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN IF NEW.action IS NULL THEN NEW.action := NEW.side; END IF; IF NEW.side IS NULL THEN NEW.side := NEW.action; END IF; RETURN NEW; END; $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    account_id text NOT NULL,
    user_id text NOT NULL,
    name text,
    balance double precision,
    status text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    api_key_hash text,
    api_key_last4 text,
    api_key_rotated_at timestamp with time zone,
    source_ids_cache jsonb,
    id bigint NOT NULL,
    sid text DEFAULT public.gen_sid('ACC'::text, 8) NOT NULL,
    equity numeric,
    margin numeric,
    free_margin numeric,
    leverage numeric,
    broker_name text
);


--
-- Name: accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.accounts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.accounts_id_seq OWNED BY public.accounts.id;


--
-- Name: ea_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ea_logs (
    id integer NOT NULL,
    account_id text,
    level text,
    message text,
    created_at timestamp with time zone DEFAULT now(),
    user_id text
);


--
-- Name: ea_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ea_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ea_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ea_logs_id_seq OWNED BY public.ea_logs.id;


--
-- Name: execution_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.execution_profiles (
    profile_id text DEFAULT (gen_random_uuid())::text NOT NULL,
    user_id text NOT NULL,
    profile_name text NOT NULL,
    route text DEFAULT 'ea'::text NOT NULL,
    account_id text,
    source_ids jsonb DEFAULT '[]'::jsonb,
    ctrader_mode text DEFAULT 'demo'::text,
    ctrader_account_id text,
    is_active boolean DEFAULT false NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.logs (
    log_id integer NOT NULL,
    object_id text,
    object_table text,
    metadata jsonb,
    user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    symbol text,
    event_type text,
    status text,
    error text,
    content text,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: logs_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.logs_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: logs_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.logs_log_id_seq OWNED BY public.logs.log_id;


--
-- Name: market_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_data (
    id bigint NOT NULL,
    symbol text NOT NULL,
    tf text NOT NULL,
    bar_start bigint NOT NULL,
    bar_end bigint NOT NULL,
    data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb,
    last_price double precision,
    last_price_at timestamp with time zone
);


--
-- Name: market_data_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.market_data_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: market_data_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.market_data_id_seq OWNED BY public.market_data.id;


--
-- Name: signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signals (
    created_at timestamp with time zone NOT NULL,
    user_id text DEFAULT 'default'::text NOT NULL,
    source text,
    action text NOT NULL,
    symbol text NOT NULL,
    volume double precision DEFAULT 0.01 NOT NULL,
    sl double precision,
    tp double precision,
    rr_planned double precision,
    note text,
    raw_json jsonb,
    status text NOT NULL,
    chart_tf text,
    metadata jsonb,
    entry_model text,
    signal_tf text,
    source_id text,
    side text,
    id bigint NOT NULL,
    sid text DEFAULT public.gen_sid('SIG'::text, 8) NOT NULL,
    entry double precision,
    risk_money_planned double precision,
    risk_pct_planned double precision,
    rejection_reason text,
    order_type text,
    strategy text,
    profile text,
    confidence_pct double precision,
    invalidation text,
    estimated_bars integer,
    exit_condition text,
    entry_condition text,
    risk_management text,
    skip_recommendation text,
    confluence_checklist jsonb,
    be_trigger double precision
);


--
-- Name: signals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.signals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: signals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.signals_id_seq OWNED BY public.signals.id;


--
-- Name: trades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trades (
    account_id text NOT NULL,
    signal_id text,
    source_id text,
    symbol text NOT NULL,
    action text NOT NULL,
    entry double precision,
    sl double precision,
    tp double precision,
    note text,
    dispatch_status text DEFAULT 'NEW'::text NOT NULL,
    lease_token text,
    lease_expires_at timestamp with time zone,
    execution_status text DEFAULT 'PENDING'::text NOT NULL,
    close_reason text,
    broker_trade_id text,
    entry_exec double precision,
    opened_at timestamp with time zone,
    closed_at timestamp with time zone,
    pnl_realized double precision,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    volume double precision,
    user_id text,
    entry_model text,
    signal_tf text,
    chart_tf text,
    id bigint NOT NULL,
    sid text DEFAULT public.gen_sid('TRD'::text, 8) NOT NULL,
    rejection_reason text,
    order_type text,
    raw_json jsonb,
    broker_pips numeric,
    broker_lots numeric,
    broker_commission numeric,
    broker_swap numeric,
    broker_volume numeric,
    broker_pnl double precision,
    broker_margin double precision,
    broker_tp_pnl double precision,
    broker_sl_pnl double precision,
    strategy text,
    profile text,
    confidence_pct double precision,
    invalidation text,
    estimated_bars integer,
    exit_condition text,
    entry_condition text,
    risk_management text,
    skip_recommendation text,
    confluence_checklist jsonb,
    be_trigger double precision,
    rr_planned double precision,
    risk_money_planned double precision,
    risk_pct_planned double precision,
    tp1 double precision,
    tp2 double precision,
    tp3 double precision,
    CONSTRAINT trades_close_reason_check CHECK (((close_reason IS NULL) OR (close_reason = ANY (ARRAY['TP'::text, 'SL'::text, 'MANUAL'::text, 'CANCEL'::text, 'EXPIRED'::text, 'FAIL'::text, 'SNAPSHOT'::text])))),
    CONSTRAINT trades_dispatch_status_check CHECK ((dispatch_status = ANY (ARRAY['NEW'::text, 'LEASED'::text, 'CONSUMED'::text]))),
    CONSTRAINT trades_execution_status_check CHECK ((execution_status = ANY (ARRAY['Draft'::text, 'PENDING'::text, 'PENDING_MOD'::text, 'PENDING_CLOSE'::text, 'PENDING_CANCEL'::text, 'OPEN'::text, 'FILLED'::text, 'CLOSED'::text, 'REJECTED'::text, 'CANCELLED'::text])))
);


--
-- Name: trades_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trades_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trades_id_seq OWNED BY public.trades.id;


--
-- Name: user_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_accounts (
    account_id text NOT NULL,
    user_id text NOT NULL,
    name text,
    balance double precision,
    api_key_hash text,
    api_key_last4 text,
    api_key_rotated_at timestamp with time zone,
    source_ids_cache jsonb,
    metadata jsonb,
    status text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    equity numeric,
    margin numeric,
    free_margin numeric,
    leverage numeric,
    broker_name text
);


--
-- Name: user_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    type text NOT NULL,
    data jsonb NOT NULL,
    status text DEFAULT 'ACTIVE'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    name text DEFAULT 'default'::text NOT NULL,
    value text
);


--
-- Name: user_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_templates (
    id integer NOT NULL,
    user_id text,
    name text NOT NULL,
    data jsonb NOT NULL,
    status text DEFAULT 'ACTIVE'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_templates_id_seq OWNED BY public.user_templates.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    user_id text NOT NULL,
    name text,
    email text,
    password_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb,
    password_salt text,
    role text,
    updated_at timestamp with time zone,
    is_active boolean,
    id bigint NOT NULL,
    sid text DEFAULT public.gen_sid('USR'::text, 8) NOT NULL
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts ALTER COLUMN id SET DEFAULT nextval('public.accounts_id_seq'::regclass);


--
-- Name: ea_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ea_logs ALTER COLUMN id SET DEFAULT nextval('public.ea_logs_id_seq'::regclass);


--
-- Name: logs log_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logs ALTER COLUMN log_id SET DEFAULT nextval('public.logs_log_id_seq'::regclass);


--
-- Name: market_data id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_data ALTER COLUMN id SET DEFAULT nextval('public.market_data_id_seq'::regclass);


--
-- Name: signals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signals ALTER COLUMN id SET DEFAULT nextval('public.signals_id_seq'::regclass);


--
-- Name: trades id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades ALTER COLUMN id SET DEFAULT nextval('public.trades_id_seq'::regclass);


--
-- Name: user_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_templates ALTER COLUMN id SET DEFAULT nextval('public.user_templates_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (account_id);


--
-- Name: ea_logs ea_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ea_logs
    ADD CONSTRAINT ea_logs_pkey PRIMARY KEY (id);


--
-- Name: execution_profiles execution_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_profiles
    ADD CONSTRAINT execution_profiles_pkey PRIMARY KEY (profile_id);


--
-- Name: logs logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logs
    ADD CONSTRAINT logs_pkey PRIMARY KEY (log_id);


--
-- Name: market_data market_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_data
    ADD CONSTRAINT market_data_pkey PRIMARY KEY (id);


--
-- Name: market_data market_data_symbol_tf_range_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_data
    ADD CONSTRAINT market_data_symbol_tf_range_key UNIQUE (symbol, tf, bar_start, bar_end);


--
-- Name: signals signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signals
    ADD CONSTRAINT signals_pkey PRIMARY KEY (sid);


--
-- Name: trades trades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_pkey PRIMARY KEY (sid);


--
-- Name: user_accounts user_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_accounts
    ADD CONSTRAINT user_accounts_pkey PRIMARY KEY (account_id);


--
-- Name: user_settings user_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_pkey PRIMARY KEY (id);


--
-- Name: user_settings user_settings_user_type_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_type_name_key UNIQUE (user_id, type, name);


--
-- Name: user_templates user_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_templates
    ADD CONSTRAINT user_templates_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: idx_accounts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_user ON public.accounts USING btree (user_id);


--
-- Name: idx_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_logs_created_at ON public.logs USING btree (created_at DESC);


--
-- Name: idx_logs_event_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_logs_event_type ON public.logs USING btree (event_type);


--
-- Name: idx_logs_object; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_logs_object ON public.logs USING btree (object_id, object_table);


--
-- Name: idx_logs_object_event_tsu; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_logs_object_event_tsu ON public.logs USING btree (object_id) WHERE (event_type = 'TRADE_SYNC_UPDATE'::text);


--
-- Name: idx_logs_symbol; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_logs_symbol ON public.logs USING btree (symbol);


--
-- Name: idx_logs_trace; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_logs_trace ON public.logs USING btree (object_id, event_type) WHERE ((object_id IS NOT NULL) AND (event_type IS NOT NULL));


--
-- Name: idx_logs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_logs_user ON public.logs USING btree (user_id);


--
-- Name: idx_market_data_symbol_tf_bar; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_data_symbol_tf_bar ON public.market_data USING btree (symbol, tf, bar_start, bar_end);


--
-- Name: idx_signals_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_created_at ON public.signals USING btree (created_at DESC);


--
-- Name: idx_signals_sid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_sid ON public.signals USING btree (sid);


--
-- Name: idx_signals_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_status ON public.signals USING btree (status);


--
-- Name: idx_signals_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_status_created ON public.signals USING btree (status, created_at);


--
-- Name: idx_signals_symbol; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_symbol ON public.signals USING btree (symbol);


--
-- Name: idx_signals_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_user ON public.signals USING btree (user_id);


--
-- Name: idx_signals_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_user_created ON public.signals USING btree (user_id, created_at);


--
-- Name: idx_trades_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trades_account ON public.trades USING btree (account_id);


--
-- Name: idx_trades_broker_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trades_broker_ticket ON public.trades USING btree (broker_trade_id);


--
-- Name: idx_trades_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trades_created_at ON public.trades USING btree (created_at DESC);


--
-- Name: idx_trades_dispatch_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trades_dispatch_queue ON public.trades USING btree (account_id, dispatch_status, created_at);


--
-- Name: idx_trades_exec_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trades_exec_status ON public.trades USING btree (execution_status);


--
-- Name: idx_trades_sid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_trades_sid ON public.trades USING btree (sid);


--
-- Name: idx_trades_signal_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trades_signal_id ON public.trades USING btree (signal_id);


--
-- Name: idx_trades_signal_sid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trades_signal_sid ON public.trades USING btree (signal_id);


--
-- Name: idx_trades_symbol; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trades_symbol ON public.trades USING btree (symbol);


--
-- Name: idx_trades_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trades_user ON public.trades USING btree (user_id);


--
-- Name: uq_accounts_api_key_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_accounts_api_key_hash ON public.accounts USING btree (api_key_hash) WHERE (api_key_hash IS NOT NULL);


--
-- Name: uq_accounts_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_accounts_id ON public.accounts USING btree (id);


--
-- Name: uq_accounts_sid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_accounts_sid ON public.accounts USING btree (sid);


--
-- Name: uq_signals_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_signals_id ON public.signals USING btree (id);


--
-- Name: uq_signals_sid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_signals_sid ON public.signals USING btree (sid);


--
-- Name: uq_trades_account_signal; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_trades_account_signal ON public.trades USING btree (account_id, signal_id) WHERE (signal_id IS NOT NULL);


--
-- Name: uq_trades_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_trades_id ON public.trades USING btree (id);


--
-- Name: uq_trades_sid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_trades_sid ON public.trades USING btree (sid);


--
-- Name: uq_users_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_users_id ON public.users USING btree (id);


--
-- Name: uq_users_sid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_users_sid ON public.users USING btree (sid);


--
-- Name: signals trg_signals_sync_action_side; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_signals_sync_action_side BEFORE INSERT OR UPDATE ON public.signals FOR EACH ROW EXECUTE FUNCTION public.signals_sync_action_side();


--
-- Name: accounts accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: execution_profiles execution_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_profiles
    ADD CONSTRAINT execution_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: signals fk_signals_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signals
    ADD CONSTRAINT fk_signals_user FOREIGN KEY (user_id) REFERENCES public.users(user_id);


--
-- Name: logs logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logs
    ADD CONSTRAINT logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: trades trades_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(account_id) ON DELETE CASCADE;


--
-- Name: trades trades_signal_sid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_signal_sid_fkey FOREIGN KEY (signal_id) REFERENCES public.signals(sid) ON DELETE SET NULL;


--
-- Name: user_accounts user_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_accounts
    ADD CONSTRAINT user_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: user_settings user_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: user_templates user_templates_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_templates
    ADD CONSTRAINT user_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

