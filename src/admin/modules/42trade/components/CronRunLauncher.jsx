import BulkActionsButton from "../../../shared/components/BulkActionsButton";

export default function CronRunLauncher({
  value = "",
  options = [],
  onChange,
  onRun,
  disabled = false,
  loading = false,
  emptyLabel = "No crons configured",
  selectAriaLabel = "Cron selector",
  runLabel = "RUN",
  runningLabel = "RUNNING...",
  getConfirmOptions,
}) {
  const items = Array.isArray(options) ? options : [];
  const hasItems = items.length > 0;
  const normalizedItems = hasItems ? items : [{ value: "", label: emptyLabel }];

  return (
    <>
      {/* <!-- COMPONENT: CronRunLauncher --> */}
      <div className="cron-run-launcher" data-component="CronRunLauncher">
        <BulkActionsButton
          items={normalizedItems}
          selectedItems={value}
          onSelectedItemsChange={onChange}
          onClick={(nextValue) => onRun?.(nextValue)}
          buttonText={loading ? runningLabel : runLabel}
          disabled={!hasItems || disabled}
          loading={loading}
          buttonDisabled={!hasItems}
          ariaLabel={selectAriaLabel}
          className="cron-run-launcher-bulk"
          getConfirmOptions={getConfirmOptions}
        />
      </div>
      {/* <!-- /COMPONENT: CronRunLauncher --> */}
    </>
  );
}
