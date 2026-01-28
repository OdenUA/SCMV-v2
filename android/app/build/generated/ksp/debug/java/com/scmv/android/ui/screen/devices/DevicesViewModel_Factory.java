package com.scmv.android.ui.screen.devices;

import com.scmv.android.data.repository.DeviceRepository;
import dagger.internal.DaggerGenerated;
import dagger.internal.Factory;
import dagger.internal.QualifierMetadata;
import dagger.internal.ScopeMetadata;
import javax.annotation.processing.Generated;
import javax.inject.Provider;

@ScopeMetadata
@QualifierMetadata
@DaggerGenerated
@Generated(
    value = "dagger.internal.codegen.ComponentProcessor",
    comments = "https://dagger.dev"
)
@SuppressWarnings({
    "unchecked",
    "rawtypes",
    "KotlinInternal",
    "KotlinInternalInJava"
})
public final class DevicesViewModel_Factory implements Factory<DevicesViewModel> {
  private final Provider<DeviceRepository> deviceRepositoryProvider;

  public DevicesViewModel_Factory(Provider<DeviceRepository> deviceRepositoryProvider) {
    this.deviceRepositoryProvider = deviceRepositoryProvider;
  }

  @Override
  public DevicesViewModel get() {
    return newInstance(deviceRepositoryProvider.get());
  }

  public static DevicesViewModel_Factory create(
      Provider<DeviceRepository> deviceRepositoryProvider) {
    return new DevicesViewModel_Factory(deviceRepositoryProvider);
  }

  public static DevicesViewModel newInstance(DeviceRepository deviceRepository) {
    return new DevicesViewModel(deviceRepository);
  }
}
