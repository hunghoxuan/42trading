import type { ComponentType, Dispatch, ReactNode, SelectHTMLAttributes, SetStateAction } from "react";
// @ts-expect-error shared JS component has no declaration file
import SharedInputComboSelect from "../../admin/shared/components/InputComboSelect";
import { t, type Language } from "./i18n";
import type { ProductForm } from "./workspace";

const InputComboSelect = SharedInputComboSelect as ComponentType<SelectHTMLAttributes<HTMLSelectElement> & {
  searchable?: boolean; allowCreate?: boolean; menuClassName?: string; placeholder?: string;
  searchPlaceholder?: string; createLabel?: string;
}>;
export type ProductOptions = { category: string[]; supplier: string[]; unit: string[] };

export default function ProductEditFields({ form, onChange, options, language, stock = 0, compact = false, imageContent }: {
  form: ProductForm; onChange: Dispatch<SetStateAction<ProductForm>>; options: ProductOptions;
  language: Language; stock?: number; compact?: boolean; imageContent?: ReactNode;
}) {
  const tr = (value: string) => t(language, value);
  const change = (field: keyof ProductForm, value: string) => onChange(current => ({ ...current, [field]: value }));
  const text = (field: keyof ProductForm, label: string, full = false) => <label className={`pay42-form-field${full ? " pay42-form-field--full" : ""}`}>
    <span className="ui-field-label">{tr(label)}</span><input value={form[field]} onChange={event => change(field, event.target.value)} />
  </label>;
  const number = (field: keyof ProductForm, label: string, max?: number) => <label className="pay42-form-field">
    <span className="ui-field-label">{tr(label)}</span><input type="number" min="0" max={max} step={field === "vat" || field === "minStock" ? "0.01" : "1"}
      className={Number(form[field]) === 0 ? "pos-zero-value" : undefined} value={form[field]} onChange={event => change(field, event.target.value)} />
  </label>;
  const attribute = (field: keyof ProductOptions, label: string) => <label className="pay42-form-field">
    <span className="ui-field-label">{tr(label)}</span>
    <InputComboSelect aria-label={tr(label)} value={form[field]} searchable allowCreate menuClassName="pos-product-attribute-menu"
      placeholder={tr("Select or enter a new value")} searchPlaceholder={tr("Search or enter a new value")} createLabel={tr("Add")}
      onChange={event => change(field, event.target.value)}>
      {field !== "unit" && <option value="">{tr("None")}</option>}
      {form[field] && !options[field].includes(form[field]) && <option value={form[field]}>{form[field]}</option>}
      {options[field].map(value => <option key={value} value={value}>{value}</option>)}
    </InputComboSelect>
  </label>;
  const status = <label className="pay42-form-field"><span className="ui-field-label">{tr("Status")}</span>
    <InputComboSelect value={form.status} onChange={event => change("status", event.target.value)}>
      <option value="ACTIVE">{tr("Active")}</option><option value="ARCHIVED">{tr("Inactive")}</option>
    </InputComboSelect>
  </label>;
  const stockFields = <>{number("minStock", "Minimum stock")}<label className="pay42-form-field">
    <span className="ui-field-label">{tr("Current Qty in Stock")}</span>
    <input type="number" className={stock === 0 ? "pos-zero-value" : undefined} value={stock} readOnly aria-readonly="true" />
  </label></>;
  return <>
    {text("name", "Name", true)}
    {text("sku", "Product number")}{text("barcodes", "Barcodes, comma separated")}
    {compact ? <>
      {number("price", "Retail price (VND)")}{attribute("unit", "Unit")}
      {attribute("category", "Category")}{attribute("supplier", "Provider")}
      <details className="pos-recognition-disclosure pay42-form-field--full">
        <summary>{tr("More fields")}</summary>
        <div className="pay42-form-grid pos-form">{status}{number("cost", "Import price (VND)")}
          {stockFields}{text("image", "Image URL", true)}{number("vat", "VAT added on top (%)", 100)}
        </div>
      </details>
    </> : <>
      {status}{attribute("unit", "Unit")}
      {number("cost", "Import price (VND)")}{number("price", "Retail price (VND)")}
      {stockFields}{attribute("category", "Category")}{attribute("supplier", "Provider")}
      {imageContent}{number("vat", "VAT added on top (%)", 100)}
    </>}
  </>;
}
