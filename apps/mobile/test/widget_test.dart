import 'package:datacube_au/app/app.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('renders the DataCube AU native workspace shell', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const DataCubeAuApp());

    expect(find.text('DATACUBE AU'), findsOneWidget);
    expect(find.text('Good to have you here.'), findsOneWidget);
  });
}
