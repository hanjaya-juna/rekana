-- REKANA - skema basis data MySQL 8
-- Jalankan otomatis dengan: npm run db:init
-- Atau manual: mysql -u root -p < database/schema.sql

CREATE DATABASE IF NOT EXISTS rekana
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE rekana;

CREATE TABLE IF NOT EXISTS admin_users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(50) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  full_name VARCHAR(80) NOT NULL DEFAULT 'Administrator',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_username (username)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS categories (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(50) NOT NULL,
  color CHAR(7) NOT NULL DEFAULT '#22385a',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_category_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
  id VARCHAR(24) NOT NULL,
  name VARCHAR(60) NOT NULL,
  category_id INT UNSIGNED NOT NULL,
  price INT UNSIGNED NOT NULL DEFAULT 0,
  stock INT UNSIGNED NOT NULL DEFAULT 0,
  description VARCHAR(300) NOT NULL DEFAULT '',
  image_url VARCHAR(255) NOT NULL DEFAULT '',
  featured TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_products_category (category_id),
  CONSTRAINT fk_products_category
    FOREIGN KEY (category_id) REFERENCES categories (id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS weather_forecasts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  forecast_date DATE NOT NULL,
  condition_text VARCHAR(50) NOT NULL,
  temp_min TINYINT NOT NULL,
  temp_max TINYINT NOT NULL,
  rain_chance TINYINT UNSIGNED NOT NULL DEFAULT 0,
  alert_level ENUM('Normal', 'Waspada', 'Siaga') NOT NULL DEFAULT 'Normal',
  updated_by INT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_weather_date (forecast_date),
  CONSTRAINT fk_weather_admin
    FOREIGN KEY (updated_by) REFERENCES admin_users (id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT chk_weather_temp CHECK (temp_min <= temp_max),
  CONSTRAINT chk_weather_rain CHECK (rain_chance <= 100)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS disaster_warnings (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(120) NOT NULL,
  message VARCHAR(500) NOT NULL,
  level ENUM('Waspada', 'Siaga', 'Awas') NOT NULL DEFAULT 'Waspada',
  area VARCHAR(100) NOT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_warnings_active (is_active, starts_at, ends_at),
  CONSTRAINT fk_warnings_admin
    FOREIGN KEY (created_by) REFERENCES admin_users (id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS incidents (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(120) NOT NULL,
  summary VARCHAR(600) NOT NULL,
  type VARCHAR(50) NOT NULL,
  location VARCHAR(120) NOT NULL,
  lat DECIMAL(9, 6) NULL,
  lng DECIMAL(9, 6) NULL,
  occurred_at DATETIME NOT NULL,
  status ENUM('pending', 'published', 'rejected') NOT NULL DEFAULT 'pending',
  reporter_name VARCHAR(80) NOT NULL DEFAULT '',
  reporter_contact VARCHAR(80) NOT NULL DEFAULT '',
  admin_note VARCHAR(300) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_incidents_status_date (status, occurred_at),
  CONSTRAINT chk_incident_lat CHECK (lat IS NULL OR (lat >= -90 AND lat <= 90)),
  CONSTRAINT chk_incident_lng CHECK (lng IS NULL OR (lng >= -180 AND lng <= 180))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transactions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(20) NOT NULL,
  customer_name VARCHAR(80) NOT NULL,
  customer_contact VARCHAR(80) NOT NULL,
  delivery_method ENUM('pickup', 'delivery') NOT NULL DEFAULT 'pickup',
  address VARCHAR(200) NOT NULL DEFAULT '',
  note VARCHAR(300) NOT NULL DEFAULT '',
  payment_method ENUM('transfer', 'qris', 'ewallet', 'cash') NOT NULL,
  total INT UNSIGNED NOT NULL DEFAULT 0,
  item_count INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('pending', 'verified', 'cancelled') NOT NULL DEFAULT 'pending',
  stock_applied TINYINT(1) NOT NULL DEFAULT 0,
  admin_note VARCHAR(300) NOT NULL DEFAULT '',
  verified_by INT UNSIGNED NULL,
  verified_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_transactions_code (code),
  KEY idx_transactions_status_created (status, created_at),
  CONSTRAINT fk_transactions_admin
    FOREIGN KEY (verified_by) REFERENCES admin_users (id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transaction_items (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  transaction_id INT UNSIGNED NOT NULL,
  product_id VARCHAR(24) NOT NULL,
  product_name VARCHAR(60) NOT NULL,
  unit_price INT UNSIGNED NOT NULL DEFAULT 0,
  quantity INT UNSIGNED NOT NULL,
  subtotal INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_transaction_items_tx (transaction_id),
  KEY idx_transaction_items_product (product_id),
  CONSTRAINT fk_transaction_items_tx
    FOREIGN KEY (transaction_id) REFERENCES transactions (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_transaction_items_product
    FOREIGN KEY (product_id) REFERENCES products (id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;
